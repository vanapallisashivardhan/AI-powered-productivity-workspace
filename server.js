import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_KEY || "";
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

if (supabase) {
    console.log("⚡ Supabase Cloud Database Client operational!");
} else {
    console.log("⚠️ WARNING: Supabase keys missing inside .env configuration!");
}

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

// ==========================================
// CORE AI VOICE PROCESSING ENDPOINT
// ==========================================
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
const tools = [
  {
    type: "function",
    function: {
      name: "process_voice_intent",
      description: "Analyze voice transcription to determine the workspace intent.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            enum: [
              "NAVIGATE", 
              "CREATE_TASK", 
              "CREATE_MEETING", 
              "COMPLETE_MEETING", // 👈 ADD THIS
              "DELETE_MEETING",   // 👈 ADD THIS
              "ANSWER_QUESTION"
            ],
            description: "The actions to take based on user audio input."
          },
          // Ensure your parameter object can pass down target titles or keywords
          targetItem: {
            type: "string",
            description: "The name, title, or topic of the meeting/task being targeted for completion or deletion."
          },
          // ... keep your other properties like page, taskData, meetingData here
        },
        required: ["command"]
      }
    }
  }
];

// ==========================================
// SUPABASE DATA ENDPOINTS (TASKS)
// ==========================================
app.get('/api/tasks', async (req, res) => {
    if (!supabase) return res.json([]);
    const { data, error } = await supabase.from('tasks').select('*').order('id', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/tasks', async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "Supabase client uninitialized" });
    const task = req.body;
    if (!task.id) return res.status(400).json({ error: "Missing identity index signature" });
    
    const { data, error } = await supabase.from('tasks').upsert({
        id: parseInt(task.id),
        title: task.title || "Untitled Task",
        priority: task.priority || "medium",
        category: task.category || "General",
        due_date: task.dueDate || task.due_date || new Date().toISOString().split('T')[0],
        completed: filterStringToBoolean(task.completed)
    });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

app.delete('/api/tasks/:id', async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "Supabase client uninitialized" });
    const { error } = await supabase.from('tasks').delete().eq('id', parseInt(req.params.id));
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

// ==========================================
// SUPABASE DATA ENDPOINTS (MEETINGS)
// ==========================================
app.get('/api/meetings', async (req, res) => {
    if (!supabase) return res.json([]);
    const { data, error } = await supabase.from('meetings').select('*').order('id', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    
    const formattedMeetings = data.map(m => ({
        id: m.id,
        title: m.title,
        date: m.date,
        time: m.time,
        participants: m.participants || "",
        description: m.description || "",
        completed: m.completed
    }));
    res.json(formattedMeetings);
});

app.post('/api/meetings', async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "Supabase client uninitialized" });
    const meeting = req.body;
    if (!meeting.id) return res.status(400).json({ error: "Missing identity index signature" });
    
    const { data, error } = await supabase.from('meetings').upsert({
        id: parseInt(meeting.id),
        title: meeting.title || "Untitled Meeting",
        date: meeting.date || new Date().toISOString().split('T')[0],
        time: meeting.time || "12:00",
        participants: meeting.participants || "",
        description: meeting.description || "",
        completed: filterStringToBoolean(meeting.completed)
    });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

app.delete('/api/meetings/:id', async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "Supabase client uninitialized" });
    const { error } = await supabase.from('meetings').delete().eq('id', parseInt(req.params.id));
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

// ==========================================
// START EXPRESS SERVER INFRASTRUCTURE
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Productivity Workspace Backend fully live at http://localhost:${PORT}`);
});