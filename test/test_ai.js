const { GoogleGenAI } = require("@google/genai");

// YOUR KEY PROVIDED: AIzaSyBXCK3Ed9M4IjhPnfaSyDkYbpYmuNLKC8w
const apiKey = "AIzaSyBXCK3Ed9M4IjhPnfaSyDkYbpYmuNLKC8w";
const modelId = "gemini-3-flash-preview";

async function testAI() {
    console.log(`--- Testing Gemini AI Connection ---`);
    console.log(`Model: ${modelId}`);
    
    if (!apiKey) {
        console.error("Error: No API key provided.");
        return;
    }

    try {
        const ai = new GoogleGenAI({ apiKey });
        console.log("Client initialized. Sending request...");

        const response = await ai.models.generateContent({
            model: modelId,
            contents: "You are a test script. Reply with 'AI connection successful!' and nothing else.",
        });

        console.log(`\nResponse from Gemini: "${response.text}"`);
        
        if (response.text.includes("successful")) {
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
