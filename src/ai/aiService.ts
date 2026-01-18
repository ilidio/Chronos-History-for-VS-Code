import { GoogleGenAI } from "@google/genai";
import * as vscode from 'vscode';

export class AIService {
    private client: GoogleGenAI | null = null;
    private modelId: string = "gemini-3-flash-preview";

    constructor() {
        this.init();
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('chronos.ai')) {
                this.init();
            }
        });
    }

    private init() {
        const config = vscode.workspace.getConfiguration('chronos.ai');
        const key = config.get<string>('apiKey');
        this.modelId = config.get<string>('model', 'gemini-3-flash-preview');

        if (key) {
            this.client = new GoogleGenAI({ apiKey: key });
        } else {
            this.client = null;
        }
    }

    public isEnabled(feature: 'smartSummaries' | 'explainChanges' | 'experimentPostMortem'): boolean {
        const config = vscode.workspace.getConfiguration('chronos.ai');
        return !!this.client && config.get<boolean>(feature, true);
    }

    private async generate(prompt: string): Promise<string> {
        if (!this.client) return "";
        try {
            const response = await this.client.models.generateContent({
                model: this.modelId,
                contents: prompt,
            });
            return response.text || "";
        } catch (e) {
            console.error("Gemini API Error:", e);
            return "";
        }
    }

    async summarizeDiff(diff: string): Promise<string> {
        if (!diff || diff.trim().length === 0) return "";
        
        const truncated = diff.substring(0, 4000);
        const prompt = `Analyze this code diff and provide a concise summary (max 5 words) describing the change. Strictly plain text, no markdown, no quotes.\n\n${truncated}`;
        
        const result = await this.generate(prompt);
        return result.trim();
    }

    async explainDiff(diff: string): Promise<string> {
        if (!diff || diff.trim().length === 0) return "No changes to explain.";

        const truncated = diff.substring(0, 6000);
        const prompt = `You are an expert software engineer. Explain the purpose and logic of the following code changes. 
        Focus on the "Why" and "What", not just the syntax. 
        Keep it brief (max 3 sentences).
        Code Diff:\n\n${truncated}`;

        return await this.generate(prompt);
    }

    async experimentPostMortem(diff: string, kept: boolean): Promise<string> {
        if (!diff || diff.trim().length === 0) return "";

        const truncated = diff.substring(0, 6000);
        const action = kept ? "committed/kept" : "discarded";
        const prompt = `The user just ${action} an experimental code session. 
        Analyze the diff below and generate a short "Post-Mortem" note.
        If kept, suggest a good commit message.
        If discarded, summarize what was attempted.
        Keep it concise.\n\n${truncated}`;

        return await this.generate(prompt);
    }
}