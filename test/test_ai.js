const { GoogleGenAI } = require("@google/genai");
const fs = require('fs');
const path = require('path');

async function testAI() {
    console.log(`--- Testing Gemini AI Connection ---`);
    
    let config;
    try {
        const configPath = path.join(__dirname, '..', '.gemini.test.json');
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
        console.error("Error: Could not load .gemini.test.json. Please create it with {apiKey, modelId}.");
        return;
    }

    const { apiKey, modelId } = config;
    console.log(`Model: ${modelId}`);
    
    if (!apiKey || apiKey.includes("YOUR_API_KEY")) {
        console.error("Error: Valid API key not found in .gemini.test.json.");
        return;
    }

    try {
        const ai = new GoogleGenAI({ apiKey });
        console.log("Client initialized. Sending request...");

        const response = await ai.models.generateContent({
            model: modelId,
            contents: "You are a test script. Reply with 'AI connection successful!' and nothing else.",
        });

        const text = response.text;

        console.log(`\nResponse from Gemini: "${text}"`);
        
        if (text.toLowerCase().includes("successful")) {
            console.log("\n✅ AI Integration Test PASSED!");
        } else {
            console.log("\n⚠️ AI Integration Test returned unexpected text.");
        }

    } catch (e) {
        console.error("\n❌ AI Integration Test FAILED!");
        console.error(e);
    }
}

testAI();
