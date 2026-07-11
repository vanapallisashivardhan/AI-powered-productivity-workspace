import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import dotenv from 'dotenv'; // 1. Add this line

// 2. Add this line right below your imports to load the keys into process.env
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// This will now properly fetch your key from the .env file
const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY || ""
});


const workspaceTools = [
    {
        type: "function",
        function: {
            name: "extract_workspace_intent",
            description: "Extract actionable intents from unstructured conversational voice user commands inside a productivity dashboard environment.",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: [
                            "NAVIGATE", "CREATE_TASK", "COMPLETE_TASK", "DELETE_TASK", 
                            "CREATE_MEETING", "COMPLETE_MEETING", "DELETE_MEETING", 
                            "CHANGE_THEME", "SEARCH", "ANSWER_QUESTION", "UNKNOWN"
                        ],
                        description: "The primary intent or data modification requested by the user."
                    },
                    targetPage: {
                        type: "string",
                        enum: ["index.html", "tasks.html", "meetings.html", "analysis.html", "settings.html"],
                        description: "The targeted page filename required if action type is NAVIGATE."
                    },
                    title: {
                        type: "string",
                        description: "The title of a new task/meeting to create, OR the target title/keyword string used to identify which existing item to COMPLETE or DELETE."
                    },
                    dueDate: {
                        type: "string",
                        description: "ISO formatted date string (YYYY-MM-DD) for task completion deadlines."
                    },
                    date: {
                        type: "string",
                        description: "ISO formatted date string (YYYY-MM-DD) designating when a scheduled meeting node falls."
                    },
                    time: {
                        type: "string",
                        description: "24-hour clock formatted time notation (HH:MM) capturing when a meeting starts."
                    },
                    themeChange: {
                        type: "string",
                        enum: ["light", "dark"],
                        description: "Set to 'light' or 'dark' if the user explicitly wants to switch themes."
                    },
                    searchQuery: {
                        type: "string",
                        description: "The filtering keyword string if the user requests to search or look something up."
                    },
                    aiResponseText: {
                        type: "string",
                        description: "Mandatory if action is ANSWER_QUESTION. Formulate a direct, elegant answer reviewing current task/meeting metrics or layout states."
                    }
                },
                required: ["action"]
            }
        }
    }
];

app.post('/api/voice-command', async (req, res) => {
    const { transcript, currentState } = req.body;

    if (!transcript) {
        return res.status(400).json({ error: "Missing sound wave text transcript data." });
    }

    try {
        const formattedState = JSON.stringify(currentState || { tasks: [], meetings: [] });

        const response = await openai.chat.completions.create({
            model: "meta-llama/llama-3.3-70b-instruct", 
            messages: [
                { 
                    role: "system", 
                    content: `You are the advanced underlying semantic NLP intelligence router for a high-tech workspace. Current reference timeline: Year 2026.
                    
                    You have access to the user's real-time workspace data below:
                    ${formattedState}
                    
                    Rules:
                    1. If the user wants to finish, check off, complete, delete, or remove a task/meeting, analyze the state text to find the item they are referring to. Provide its raw title as the 'title' parameter, and use the correct matching modification action (e.g., COMPLETE_TASK, DELETE_TASK).
                    2. If they ask a structural question analyzing what's upcoming, outstanding, or done (e.g. "what are my upcoming tasks?"), set action to 'ANSWER_QUESTION' and synthesize a concise summary inside the 'aiResponseText' parameter.`
                },
                { role: "user", content: transcript }
            ],
            tools: workspaceTools,
            tool_choice: "auto"
        });

        const toolCall = response.choices?.[0]?.message?.tool_calls?.[0];
        if (!toolCall) {
            return res.json({ action: "UNKNOWN" });
        }

        const structuredResponse = JSON.parse(toolCall.function.arguments);
        res.json(structuredResponse);

    } catch (error) {
        console.error("[Backend Log]:", error);
        res.status(500).json({ action: "UNKNOWN", error: "Internal AI processing vector fault." });
    }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 OpenRouter-Powered Productivity Backend operational at http://localhost:${PORT}`));