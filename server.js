import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import mongoose from 'mongoose';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// --- 1. MongoDB Connection ---
const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || "";

if (mongoUri) {
    mongoose.connect(mongoUri)
        .then(() => console.log("⚡ MongoDB Database operational & connected!"))
        .catch(err => console.error("❌ MongoDB Connection Error:", err.message));
} else {
    console.log("⚠️ WARNING: MONGODB_URI/MONGO_URI missing inside .env configuration!");
}

// --- 2. Mongoose Schemas & Models ---
const taskSchema = new mongoose.Schema({
    id: { type: Number, required: true, unique: true },
    title: { type: String, default: "Untitled Task" },
    priority: { type: String, default: "medium" },
    category: { type: String, default: "General" },
    due_date: { type: String },
    completed: { type: Boolean, default: false }
}, { timestamps: true });

const meetingSchema = new mongoose.Schema({
    id: { type: Number, required: true, unique: true },
    title: { type: String, default: "Untitled Meeting" },
    date: { type: String },
    time: { type: String, default: "12:00" },
    participants: { type: String, default: "" },
    description: { type: String, default: "" },
    completed: { type: Boolean, default: false }
}, { timestamps: true });

const Task = mongoose.model('Task', taskSchema);
const Meeting = mongoose.model('Meeting', meetingSchema);

// --- 3. OpenRouter / OpenAI Config ---
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

// Helper to sanitize boolean values from dynamic payloads
function filterStringToBoolean(val) {
    if (typeof val === 'boolean') return val;
    return val === 'true';
}

// --- 4. CORE AI VOICE PROCESSING ENDPOINT ---
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
                    content: `You are the advanced underlying semantic NLP intelligence router for a high-tech workspace. Reference timeline: Year 2026.
                    
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

// --- 5. MONGODB DATA ENDPOINTS (TASKS) ---

app.get('/api/tasks', async (req, res) => {
    try {
        const tasks = await Task.find().sort({ id: -1 }).lean();
        const formattedTasks = tasks.map(t => ({
            id: t.id,
            title: t.title,
            priority: t.priority,
            category: t.category,
            dueDate: t.due_date,
            due_date: t.due_date,
            completed: t.completed
        }));
        res.json(formattedTasks);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/tasks', async (req, res) => {
    const task = req.body;
    if (!task.id) return res.status(400).json({ error: "Missing identity index signature" });

    try {
        const payload = {
            id: parseInt(task.id),
            title: task.title || "Untitled Task",
            priority: task.priority || "medium",
            category: task.category || "General",
            due_date: task.dueDate || task.due_date || new Date().toISOString().split('T')[0],
            completed: filterStringToBoolean(task.completed)
        };

        await Task.findOneAndUpdate({ id: parseInt(task.id) }, payload, { upsert: true, new: true });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/tasks/:id', async (req, res) => {
    try {
        await Task.deleteOne({ id: parseInt(req.params.id) });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- 6. MONGODB DATA ENDPOINTS (MEETINGS) ---

app.get('/api/meetings', async (req, res) => {
    try {
        const meetings = await Meeting.find().sort({ id: -1 }).lean();
        const formattedMeetings = meetings.map(m => ({
            id: m.id,
            title: m.title,
            date: m.date,
            time: m.time,
            participants: m.participants || "",
            description: m.description || "",
            completed: m.completed
        }));
        res.json(formattedMeetings);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/meetings', async (req, res) => {
    const meeting = req.body;
    if (!meeting.id) return res.status(400).json({ error: "Missing identity index signature" });

    try {
        const payload = {
            id: parseInt(meeting.id),
            title: meeting.title || "Untitled Meeting",
            date: meeting.date || new Date().toISOString().split('T')[0],
            time: meeting.time || "12:00",
            participants: meeting.participants || "",
            description: meeting.description || "",
            completed: filterStringToBoolean(meeting.completed)
        };

        await Meeting.findOneAndUpdate({ id: parseInt(meeting.id) }, payload, { upsert: true, new: true });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/meetings/:id', async (req, res) => {
    try {
        await Meeting.deleteOne({ id: parseInt(req.params.id) });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- 7. START EXPRESS SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Productivity Workspace Backend fully live at http://localhost:${PORT}`);
});