const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const os = require("os");

/**
 * Local development server for testing providers .
 */
class DevServer {
  constructor() {
    this.app = express();
    this.port = 3001;
    this.distDir = path.join(__dirname, "dist");
    this.currentDir = path.join(__dirname);

    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    // Enable CORS for mobile app
    this.app.use(
      cors({
        origin: "*",
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
      })
    );

    // Serve static files from dist directory
    this.app.use("/dist", express.static(this.distDir));

    // JSON parsing
    this.app.use(express.json());

    // Logging
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
      next();
    });
  }

  setupRoutes() {
    // Serve manifest.json
    this.app.get("/manifest.json", (req, res) => {
      const manifestPath = path.join(this.currentDir, "manifest.json");
      console.log(`Serving manifest from: ${manifestPath}`);

      if (fs.existsSync(manifestPath)) {
        res.sendFile(manifestPath);
      } else {
        res.status(404).json({ error: "Manifest not found. Run build first." });
      }
    });

    // Serve individual provider files
    this.app.get("/dist/:provider/:file", (req, res) => {
      const { provider, file } = req.params;
      const filePath = path.join(this.distDir, provider, file);

      if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
      } else {
        res.status(404).json({
          error: `File not found: ${provider}/${file}`,
          hint: "Make sure to run build first",
        });
      }
    });

    // Get provider catalog
    this.app.get("/catalog/:provider", (req, res) => {
      try {
        const { provider } = req.params;
        const catalogPath = path.join(__dirname, "providers", provider, "catalog.ts");

        if (fs.existsSync(catalogPath)) {
          // Read and parse the TypeScript catalog file
          const catalogContent = fs.readFileSync(catalogPath, 'utf8');

          // Extract catalog array using regex - more flexible pattern
          const catalogMatch = catalogContent.match(/export const catalog = (\[[\s\S]*?\]);/);
          if (catalogMatch) {
            try {
              // Convert TypeScript object notation to JSON
              let catalogStr = catalogMatch[1]
                .replace(/(\w+):\s*/g, '"$1": ') // Convert property names to quoted strings with proper spacing
                .replace(/,(\s*[\]\}])/g, '$1') // Remove trailing commas
                .replace(/'/g, '"'); // Convert single quotes to double quotes

              console.log('Parsing catalog string:', catalogStr);
              const catalog = JSON.parse(catalogStr);
              console.log(`Loaded catalog for ${provider}:`, catalog);
              res.json(catalog);
              return;
            } catch (parseError) {
              console.error('Failed to parse catalog:', parseError);
              console.log('Raw catalog match:', catalogMatch[1]);
              console.log('Processed catalog string:', catalogStr);
            }
          } else {
            console.log('No catalog match found in:', catalogContent.substring(0, 200));
          }
        } else {
          console.log('Catalog file not found:', catalogPath);
        }

        // Fallback to default catalog
        res.json([
          { title: 'Popular', filter: '' },
          { title: 'Latest', filter: 'latest' }
        ]);
      } catch (error) {
        console.error("Catalog error:", error);
        res.status(500).json({ error: error.message });
      }
    });

    // Execute provider functions
    this.app.post("/execute-provider", async (req, res) => {
      try {
        const { provider, function: functionName, params } = req.body;

        if (!provider || !functionName || !params) {
          return res.status(400).json({
            error: "Missing required fields: provider, function, params"
          });
        }

        const result = await this.executeProviderFunction(provider, functionName, params);
        res.json(result);
      } catch (error) {
        console.error("Provider execution error:", error);
        res.status(500).json({
          error: error.message || "Provider execution failed"
        });
      }
    });

    // Build endpoint - trigger rebuild
    this.app.post("/build", (req, res) => {
      try {
        console.log("🔨 Triggering rebuild...");
        execSync("node build.js", { stdio: "inherit" });
        res.json({ success: true, message: "Build completed" });
      } catch (error) {
        console.error("Build failed:", error);
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    });

    // Status endpoint
    this.app.get("/status", (req, res) => {
      const providers = this.getAvailableProviders();
      res.json({
        status: "running",
        port: this.port,
        providers: providers.length,
        providerList: providers,
        buildTime: this.getBuildTime(),
      });
    });

    // List available providers
    this.app.get("/providers", (req, res) => {
      const providers = this.getAvailableProviders();
      res.json(providers);
    });

    // Health check
    this.app.get("/health", (req, res) => {
      res.json({ status: "healthy", timestamp: new Date().toISOString() });
    });

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        error: "Not found",
        availableEndpoints: [
          "GET /manifest.json",
          "GET /dist/:provider/:file",
          "POST /build",
          "GET /status",
          "GET /providers",
          "GET /health",
        ],
      });
    });
  }

  getAvailableProviders() {
    if (!fs.existsSync(this.distDir)) {
      return [];
    }

    return fs
      .readdirSync(this.distDir, { withFileTypes: true })
      .filter((item) => item.isDirectory())
      .map((item) => item.name);
  }

  getBuildTime() {
    const manifestPath = path.join(this.currentDir, "manifest.json");
    if (fs.existsSync(manifestPath)) {
      const stats = fs.statSync(manifestPath);
      return stats.mtime.toISOString();
    }
    return null;
  }

  async executeProviderFunction(provider, functionName, params) {
    try {
      // Import the provider context
      const { providerContext } = require(path.join(__dirname, "dist", "providerContext"));

      // Map function names to actual provider functions
      const functionMap = {
        'getPosts': 'getPosts',
        'getSearchPosts': 'getSearchPosts',
        'getMeta': 'getMeta',
        'getStream': 'getStream',
        'getEpisodes': 'getEpisodes'
      };

      const actualFunctionName = functionMap[functionName];
      if (!actualFunctionName) {
        throw new Error(`Unknown function: ${functionName}`);
      }

      // Import the specific provider function
      let providerFunction;
      let modulePath;

      try {
        // Use compiled versions from dist directory
        if (functionName === 'getPosts' || functionName === 'getSearchPosts') {
          modulePath = path.join(this.distDir, provider, 'posts.js');
          const module = require(modulePath);
          providerFunction = functionName === 'getPosts' ? module.getPosts : module.getSearchPosts;
        } else if (functionName === 'getMeta') {
          modulePath = path.join(this.distDir, provider, 'meta.js');
          const module = require(modulePath);
          providerFunction = module.getMeta;
        } else if (functionName === 'getStream') {
          modulePath = path.join(this.distDir, provider, 'stream.js');
          const module = require(modulePath);
          providerFunction = module.getStream;
        } else if (functionName === 'getEpisodes') {
          modulePath = path.join(this.distDir, provider, 'episodes.js');
          const module = require(modulePath);
          providerFunction = module.getEpisodes;
        }

        // Clear require cache to get fresh module
        if (modulePath && require.cache[modulePath]) {
          delete require.cache[modulePath];
          const module = require(modulePath);
          if (functionName === 'getPosts' || functionName === 'getSearchPosts') {
            providerFunction = functionName === 'getPosts' ? module.getPosts : module.getSearchPosts;
          } else if (functionName === 'getMeta') {
            providerFunction = module.getMeta;
          } else if (functionName === 'getStream') {
            providerFunction = module.getStream;
          } else if (functionName === 'getEpisodes') {
            providerFunction = module.getEpisodes;
          }
        }
      } catch (importError) {
        console.error(`Import error for ${provider}/${functionName}:`, importError.message);
        throw new Error(`Provider function not found: ${provider}/${functionName}`);
      }

      if (!providerFunction) {
        throw new Error(`Function not exported: ${functionName} from ${provider}`);
      }

      // Execute the function with proper parameters
      const signal = new AbortController().signal;
      const executionParams = {
        ...params,
        providerValue: provider,
        signal,
        providerContext
      };

      const result = await providerFunction(executionParams);
      return result;
    } catch (error) {
      console.error(`Error executing ${provider}.${functionName}:`, error);
      throw error;
    }
  }

  start() {
    // Get local IP address
    const interfaces = os.networkInterfaces();
    let localIp = "localhost";
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === "IPv4" && !iface.internal) {
          localIp = iface.address;
          break;
        }
      }
      if (localIp !== "localhost") break;
    }
    this.app.listen(this.port, "0.0.0.0", () => {
      console.log(`
🚀 Vega Providers Dev Server Started!

📡 Server URL: http://localhost:${this.port}
📱 Mobile Test URL: http://${localIp}:${this.port}

💡 Usage:
  1. Run 'npm run auto' to to start the dev server ☑️
  2. Update vega app to use: http://${localIp}:${this.port}
  3. Test your providers!

🔄 Auto-rebuild: POST to /build to rebuild after changes
      `);

      // Check if build exists
      if (!fs.existsSync(this.distDir)) {
        console.log('\n⚠️  No build found. Run "node build.js" first!\n');
      }
    });
  }
}

// Start the server
const server = new DevServer();
server.start();
