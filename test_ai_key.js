
const { GoogleGenAI } = require("@google/genai");
const fs = require('fs');

const testSecrets = JSON.parse(fs.readFileSync('test_secrets.json', 'utf8'));
const API_KEY = testSecrets.googleApiKey;
const ai = new GoogleGenAI({ apiKey: API_KEY });
const MODEL = testSecrets.model;

async function testFeatures() {
    console.log("Starting AI Test with model: " + MODEL);

    try {
        console.log("Sending request...");
        const response = await ai.models.generateContent({
            model: MODEL,
            contents: "Hello, reply with exactly one word: SUCCESS."
        });
        
        console.log("Result: " + (response.text || "EMPTY TEXT"));
    } catch (error) {
        console.error("Error details:", error);
    }
}

testFeatures();
