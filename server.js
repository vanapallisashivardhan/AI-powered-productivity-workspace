import dotenv from 'dotenv';

dotenv.config();

import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.CORS_ORIGIN) app.use(cors({ origin: process.env.CORS_ORIGIN.split(',').map(value => value.trim()) }));

// Expanded JSON limit to support image/avatar base64 string uploads safely
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use((req, res, next) => {
    let requestPath;
    try {
        requestPath = decodeURIComponent(req.path);
    } catch {
        return res.sendStatus(400);
    }

    const filename = path.posix.basename(requestPath);
    if (/^(?:\.env(?:\..*)?|.*(?:credential|secret).*|vapid-keys\.json)$/i.test(filename)) {
        return res.sendStatus(404);
    }
    next();
});
app.use(express.static(__dirname, { dotfiles: 'ignore', index: 'index.html' }));

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET is required and must contain at least 32 characters. Add it to your .env file.');
}
// MongoDB is connected before the HTTP server starts.
const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || '';

// --- 2. Mongoose Schemas & Models ---

// User Schema for Auth
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true }
}, { timestamps: true });

// User Profile Schema bound to User
const userProfileSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    name: { type: String, default: "" },
    email: { type: String, default: "" },
    role: { type: String, default: "" },
    phone: { type: String, default: "" },
    location: { type: String, default: "" },
    bio: { type: String, default: "" },
    avatar: { type: String, default: "" } // Base64 image payload or public URL string
}, { timestamps: true });

// Task Schema bound to User
const taskSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    id: { type: Number, required: true },
    title: { type: String, default: "Untitled Task" },
    due_date: { type: String },
    due_time: { type: String, default: "" },
    completed: { type: Boolean, default: false },
    overdue: { type: Boolean, default: false }
}, { timestamps: true });

// Scoped uniqueness per user (User A & User B can both have an item with id: 1)
taskSchema.index({ userId: 1, id: 1 }, { unique: true });

// Meeting Schema bound to User
const meetingSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    id: { type: Number, required: true },
    title: { type: String, default: "Untitled Meeting" },
    date: { type: String },
    time: { type: String, default: "12:00" },
    description: { type: String, default: "" },
    completed: { type: Boolean, default: false },
    overdue: { type: Boolean, default: false }
}, { timestamps: true });

// Scoped uniqueness per user
meetingSchema.index({ userId: 1, id: 1 }, { unique: true });

const User = mongoose.model('User', userSchema);
const UserProfile = mongoose.model('UserProfile', userProfileSchema);
const Task = mongoose.model('Task', taskSchema);
const Meeting = mongoose.model('Meeting', meetingSchema);

// --- 3. JWT Authentication Middleware ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: "Access Denied: Missing access token" });
    }

    jwt.verify(token, JWT_SECRET, (err, decodedUser) => {
        if (err) {
            return res.status(403).json({ error: "Access Denied: Invalid or expired token" });
        }
        req.user = decodedUser;
        next();
    });
};

app.get('/api/health', (req, res) => {
    res.status(mongoose.connection.readyState === 1 ? 200 : 503).json({
        status: mongoose.connection.readyState === 1 ? 'ok' : 'database_unavailable',
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).select('_id email createdAt').lean();
        if (!user) return res.status(401).json({ error: 'Account no longer exists. Please sign in again.' });
        res.json({ userId: user._id, email: user.email, createdAt: user.createdAt });
    } catch (error) {
        res.status(503).json({ error: 'Unable to verify the account right now.' });
    }
});

app.use('/api', (req, res, next) => {
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ error: 'Database is not connected. Please try again shortly.' });
    }
    next();
});

// Helper function to handle string/boolean values
function filterStringToBoolean(val) {
    if (typeof val === 'boolean') return val;
    return val === 'true';
}

// --- 4. User Authentication Routes ---

// REGISTER ROUTE
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: "Email and password are required." });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
            return res.status(400).json({ error: "Enter a valid email and a password with at least 8 characters." });
        }

        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ error: "An account with this email already exists." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await User.create({ email, password: hashedPassword });

        // Initialize empty baseline profile document for new registered user
        await UserProfile.create({ 
            userId: newUser._id, 
            email: newUser.email,
            name: newUser.email.split('@')[0]
        });

        const token = jwt.sign({ userId: newUser._id, email: newUser.email }, JWT_SECRET, { expiresIn: '7d' });

        res.status(201).json({
            token,
            userId: newUser._id,
            email: newUser.email
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// LOGIN ROUTE
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: "Email and password are required." });
        }

        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
            return res.status(400).json({ error: "Invalid credentials." });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: "Invalid credentials." });
        }

        const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

        res.json({
            token,
            userId: user._id,
            email: user.email
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- 5. User Profile MongoDB Endpoints (User Scoped) ---

// GET Profile Details
app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        let profile = await UserProfile.findOne({ userId }).lean();

        if (!profile) {
            // Return baseline profile object if none exists
            profile = {
                userId,
                email: req.user.email || "",
                name: req.user.email ? req.user.email.split('@')[0] : "",
                role: "",
                phone: "",
                location: "",
                bio: "",
                avatar: ""
            };
        }

        res.json(profile);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST Save/Update Profile Details
app.post('/api/profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { name, fullName, email, role, jobTitle, phone, phoneNumber, location, workLocation, bio, avatar } = req.body;

        const updatedProfile = await UserProfile.findOneAndUpdate(
            { userId },
            {
                userId,
                name: fullName || name || "",
                email: email || req.user.email,
                role: jobTitle || role || "",
                phone: phoneNumber || phone || "",
                location: workLocation || location || "",
                bio: bio || "",
                ...(avatar && { avatar }) // Only update avatar field if passed
            },
            { upsert: true, new: true }
        );

        res.json({ success: true, profile: updatedProfile });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/user/profile - Dedicated endpoint for MongoDB profile updates
app.put('/api/user/profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { fullName, name, email, jobTitle, role, phoneNumber, phone, workLocation, location, bio, avatar } = req.body;

        const profileData = {
            userId,
            name: fullName || name || "",
            email: email || req.user.email,
            role: jobTitle || role || "",
            phone: phoneNumber || phone || "",
            location: workLocation || location || "",
            bio: bio || "",
            ...(avatar && { avatar })
        };

        const updatedProfile = await UserProfile.findOneAndUpdate(
            { userId },
            profileData,
            { upsert: true, new: true, runValidators: true }
        );

        res.status(200).json({ success: true, message: 'Profile updated in MongoDB successfully!', profile: updatedProfile });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Database error', error: error.message });
    }
});

// --- 6. OpenRouter / OpenAI Config & Voice Engine ---
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
                        enum: ["index.html", "tasks.html", "meetings.html", "profile.html", "settings.html"],
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

// AI Voice Processing Route (Authenticated)
app.post('/api/voice-command', authenticateToken, async (req, res) => {
    if (!process.env.OPENROUTER_API_KEY) return res.status(503).json({ error: 'Voice AI is not configured. Add OPENROUTER_API_KEY to .env.' });
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

// --- 7. MONGODB TASKS ENDPOINTS (User Scoped) ---

app.get('/api/tasks', authenticateToken, async (req, res) => {
    try {
        const tasks = await Task.find({ userId: req.user.userId }).sort({ id: -1 }).lean();
        const formattedTasks = tasks.map(t => ({
            id: t.id,
            title: t.title,
            dueDate: t.due_date,
            due_date: t.due_date,
            dueTime: t.due_time || "",
            due_time: t.due_time || "",
            completed: t.completed,
            overdue: t.overdue || false
        }));
        res.json(formattedTasks);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/tasks', authenticateToken, async (req, res) => {
    const task = req.body;
    if (!task.id) return res.status(400).json({ error: "Missing identity index signature" });

    try {
        const payload = {
            userId: req.user.userId,
            id: parseInt(task.id),
            title: task.title || "Untitled Task",
            due_date: task.dueDate || task.due_date || new Date().toISOString().split('T')[0],
            due_time: task.dueTime || task.due_time || "",
            completed: filterStringToBoolean(task.completed),
            overdue: filterStringToBoolean(task.overdue)
        };

        await Task.findOneAndUpdate(
            { userId: req.user.userId, id: parseInt(task.id) }, 
            payload, 
            { upsert: true, new: true }
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT TASK UPDATE/COMPLETION ROUTE
app.put('/api/tasks/:id', authenticateToken, async (req, res) => {
    try {
        const taskId = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(taskId)) return res.status(400).json({ error: 'Invalid task ID.' });
        const updateFields = {};

        for (const field of ['title', 'due_date', 'due_time', 'completed', 'overdue']) {
            if (req.body[field] !== undefined) updateFields[field] = req.body[field];
        }
        if (req.body.dueDate !== undefined) updateFields.dueDate = req.body.dueDate;
        if (req.body.dueTime !== undefined) updateFields.dueTime = req.body.dueTime;

        // Normalize dueDate to due_date mapping if passed from frontend
        if (updateFields.dueDate !== undefined) {
            updateFields.due_date = updateFields.dueDate;
            delete updateFields.dueDate;
        }

        if (updateFields.dueTime !== undefined) {
            updateFields.due_time = updateFields.dueTime;
            delete updateFields.dueTime;
        }
        if (updateFields.completed !== undefined) {
            updateFields.completed = filterStringToBoolean(updateFields.completed);
        }

        const updatedTask = await Task.findOneAndUpdate(
            { userId: req.user.userId, id: taskId },
            { $set: updateFields },
            { new: true }
        );

        if (!updatedTask) {
            return res.status(404).json({ error: "Task node not found" });
        }

        res.json({ success: true, task: updatedTask });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/tasks/:id', authenticateToken, async (req, res) => {
    try {
        await Task.deleteOne({ userId: req.user.userId, id: parseInt(req.params.id) });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- 8. MONGODB MEETINGS ENDPOINTS (User Scoped) ---

app.get('/api/meetings', authenticateToken, async (req, res) => {
    try {
        const meetings = await Meeting.find({ userId: req.user.userId }).sort({ id: -1 }).lean();
        const formattedMeetings = meetings.map(m => ({
            id: m.id,
            title: m.title,
            date: m.date,
            time: m.time,
            description: m.description || "",
            completed: m.completed,
            overdue: m.overdue || false
        }));
        res.json(formattedMeetings);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/meetings', authenticateToken, async (req, res) => {
    const meeting = req.body;
    if (!meeting.id) return res.status(400).json({ error: "Missing identity index signature" });

    try {
        const payload = {
            userId: req.user.userId,
            id: parseInt(meeting.id),
            title: meeting.title || "Untitled Meeting",
            date: meeting.date || new Date().toISOString().split('T')[0],
            time: meeting.time || "12:00",
            description: meeting.description || "",
            completed: filterStringToBoolean(meeting.completed),
            overdue: filterStringToBoolean(meeting.overdue)
        };

        await Meeting.findOneAndUpdate(
            { userId: req.user.userId, id: parseInt(meeting.id) }, 
            payload, 
            { upsert: true, new: true }
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT MEETING UPDATE/COMPLETION ROUTE
app.put('/api/meetings/:id', authenticateToken, async (req, res) => {
    try {
        const meetingId = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(meetingId)) return res.status(400).json({ error: 'Invalid meeting ID.' });
        const updateFields = {};
        for (const field of ['title', 'date', 'time', 'description', 'completed', 'overdue']) {
            if (req.body[field] !== undefined) updateFields[field] = req.body[field];
        }

        if (updateFields.completed !== undefined) {
            updateFields.completed = filterStringToBoolean(updateFields.completed);
        }
        const updatedMeeting = await Meeting.findOneAndUpdate(
            { userId: req.user.userId, id: meetingId },
            { $set: updateFields },
            { new: true }
        );

        if (!updatedMeeting) {
            return res.status(404).json({ error: "Meeting node not found" });
        }

        res.json({ success: true, meeting: updatedMeeting });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/meetings/:id', authenticateToken, async (req, res) => {
    try {
        await Meeting.deleteOne({ userId: req.user.userId, id: parseInt(req.params.id) });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- 9. START EXPRESS SERVER ---
const PORT = Number(process.env.PORT || 3000);
if (!mongoUri) {
    throw new Error('MONGO_URI is required. Add your MongoDB connection string to .env.');
}

try {
    await mongoose.connect(mongoUri, {
        serverSelectionTimeoutMS: 10000,
        maxPoolSize: 10,
        minPoolSize: 1
    });
    console.log('MongoDB connected successfully.');
} catch (error) {
    console.error('MongoDB connection failed:', error.message);
    process.exit(1);
}

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`AI Productivity Workspace running at http://localhost:${PORT}`);
});

const shutdown = async () => {
    server.close(async () => {
        await mongoose.disconnect();
        process.exit(0);
    });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);