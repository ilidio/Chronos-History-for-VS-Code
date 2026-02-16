import { GoogleGenAI } from "@google/genai";
import * as vscode from 'vscode';

export class AIService {
    private client: GoogleGenAI | null = null;
    private modelId: string = "models/gemini-3-flash-preview";

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
        this.modelId = config.get<string>('model', 'models/gemini-3-flash-preview');

        if (key) {
            this.client = new GoogleGenAI({ apiKey: key });
        } else {
            this.client = null;
        }
    }

    public isEnabled(feature: string): boolean {
        const config = vscode.workspace.getConfiguration('chronos.ai');
        return !!this.client && config.get<boolean>(feature, true);
    }

    private async generate(prompt: string): Promise<string> {
        if (!this.client) {
            console.error("AIService: Client not initialized");
            return "AI Client not initialized. Please check your API key.";
        }
        try {
            const response = await this.client.models.generateContent({
                model: this.modelId,
                contents: prompt,
            });
            
            // The @google/genai SDK response structure from user's snippet
            const text = response.text || "";
            if (!text) {
                console.warn("AIService: Received empty response from Gemini");
            }
            return text;
        } catch (e) {
            console.error("Gemini API Error:", e);
            return `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
    }

    async summarizeDiff(diff: string): Promise<string> {
        if (!diff || diff.trim().length === 0) return "";
        
        const config = vscode.workspace.getConfiguration('chronos.ai');
        const language = config.get<string>('language', 'English');
        
        const truncated = diff.substring(0, 4000);
        const prompt = `Analyze this code diff and provide a concise summary (max 5 words) describing the change in ${language}. Strictly plain text, no markdown, no quotes.\n\n${truncated}`;
        
        const result = await this.generate(prompt);
        return result.trim();
    }

    async explainDiff(diff: string): Promise<string> {
        if (!diff || diff.trim().length === 0) return "No changes to explain.";

        const config = vscode.workspace.getConfiguration('chronos.ai');
        const language = config.get<string>('language', 'English');
        
        const truncated = diff.substring(0, 6000);
        const prompt = `You are an expert software engineer. Explain the purpose and logic of the following code changes in ${language}. 
        Focus on the "Why" and "What", not just the syntax. 
        Keep it brief (max 3 sentences).
        Code Diff:\n\n${truncated}`;

        return await this.generate(prompt);
    }

    async experimentPostMortem(diff: string, kept: boolean): Promise<string> {
        if (!diff || diff.trim().length === 0) return "";

        const config = vscode.workspace.getConfiguration('chronos.ai');
        const language = config.get<string>('language', 'English');

        const truncated = diff.substring(0, 6000);
        const action = kept ? "committed/kept" : "discarded";
        const prompt = `The user just ${action} an experimental code session. 
        Analyze the diff below and generate a short "Post-Mortem" note in ${language}.
        If kept, suggest a good commit message.
        If discarded, summarize what was attempted.
        Keep it concise.\n\n${truncated}`;

        return await this.generate(prompt);
    }

    async semanticSearch(query: string, snapshotsMeta: string): Promise<string> {
        const prompt = `You are an AI assistant helping a developer search their code history.
        User Query: "${query}"
        
        Available Snapshots (ID, Label, File, Date):
        ${snapshotsMeta}
        
        Analyze the query and the labels/paths. Return a JSON array of Snapshot IDs that are most relevant to the user's intent. 
        Return ONLY the JSON array, no other text.`;
        
        return await this.generate(prompt);
    }

    async generateCommitMessage(diffs: string): Promise<string> {
        const config = vscode.workspace.getConfiguration('chronos.ai');
        const language = config.get<string>('language', 'English');
        const prompt = `You are an expert developer. Based on the following combined diffs of changes made since the last commit, generate a structured, professional Git commit message in ${language}.
        Use Conventional Commits format. 
        Summarize the main changes clearly.
        
        Diffs:
        ${diffs.substring(0, 10000)}
        
        Commit Message:`;
        
        return await this.generate(prompt);
    }

    async generateDailyBriefing(summaryData: string): Promise<string> {
        const config = vscode.workspace.getConfiguration('chronos.ai');
        const language = config.get<string>('language', 'English');
        
        const prompt = `You are a helpful coding assistant. Below is a summary of a developer's activity from their previous session (filenames and change summaries).
        Generate a friendly "Daily Briefing" that summarizes their progress in ${language}. 
        Focus on high-level achievements (e.g., "Yesterday you refactored the Auth module...").
        Keep it to 2-3 bullet points.
        
        Activity Data:
        ${summaryData}
        
        Briefing:`;
        
        return await this.generate(prompt);
    }

    async generateChangelog(activityData: string): Promise<string> {
        const config = vscode.workspace.getConfiguration('chronos.ai');
        const language = config.get<string>('language', 'English');

        const prompt = `You are an expert technical writer. Based on the following historical activity data (filenames and change summaries), generate a professional CHANGELOG.md draft in ${language}.
        Organize it by categories (e.g., Features, Bug Fixes, Refactoring).
        Use clean Markdown formatting.
        
        Activity Data:
        ${activityData}
        
        Changelog Draft:`;
        
        return await this.generate(prompt);
    }
}