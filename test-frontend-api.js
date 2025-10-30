// Test script to check if frontend can communicate with backend
const axios = require('axios');

async function testFrontendAPI() {
    console.log('Testing Frontend API Integration...\n');
    
    try {
        // Test 1: Check if frontend can reach backend manifest
        console.log('1. Testing manifest endpoint...');
        const manifestResponse = await axios.get('http://localhost:3001/manifest.json');
        console.log(`✅ Manifest loaded: ${manifestResponse.data.length} providers`);
        
        // Test 2: Check catalog endpoint
        console.log('\n2. Testing catalog endpoint...');
        const catalogResponse = await axios.get('http://localhost:3001/catalog/vega');
        console.log(`✅ Catalog loaded: ${catalogResponse.data.length} categories`);
        console.log('Categories:', catalogResponse.data.map(c => c.title).join(', '));
        
        // Test 3: Check posts endpoint
        console.log('\n3. Testing posts endpoint...');
        const postsResponse = await axios.post('http://localhost:3001/execute-provider', {
            provider: 'vega',
            function: 'getPosts',
            params: { filter: '', page: 1 }
        });
        console.log(`✅ Posts loaded: ${postsResponse.data.length} movies`);
        console.log('First 3 movies:');
        postsResponse.data.slice(0, 3).forEach((movie, i) => {
            console.log(`  ${i+1}. ${movie.title}`);
        });
        
        console.log('\n🎉 All API tests passed! The backend is working correctly.');
        console.log('\n📱 Frontend should be accessible at: http://localhost:3002');
        
    } catch (error) {
        console.error('❌ API test failed:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
    }
}

testFrontendAPI();