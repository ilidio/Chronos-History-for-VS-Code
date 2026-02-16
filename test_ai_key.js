
const { GoogleGenAI } = require("@google/genai");

const API_KEY = "AIzaSyDES-vNzaa_7ub10oXOR-VuvxXwUpPADTI";
const ai = new GoogleGenAI({ apiKey: API_KEY });
const MODEL = "models/gemini-3-flash-preview";

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
