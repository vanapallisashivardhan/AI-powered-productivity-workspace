import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const app = express();
app.use(cors());

// Expanded JSON limit to support image/avatar base64 string uploads safely
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static('.'));

const JWT_SECRET = process.env.JWT_SECRET || 'productivity_workspace_jwt_secret_key_2026';

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
    priority: { type: String, default: "medium" },
    category: { type: String, default: "General" },
    due_date: { type: String },
    completed: { type: Boolean, default: false }
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
    participants: { type: String, default: "" },
    description: { type: String, default: "" },
    completed: { type: Boolean, default: false }
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
                        enum: ["index.html", "tasks.html", "meetings.html", "analysis.html", "profile.html", "settings.html"],
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

app.post('/api/tasks', authenticateToken, async (req, res) => {
    const task = req.body;
    if (!task.id) return res.status(400).json({ error: "Missing identity index signature" });

    try {
        const payload = {
            userId: req.user.userId,
            id: parseInt(task.id),
            title: task.title || "Untitled Task",
            priority: task.priority || "medium",
            category: task.category || "General",
            due_date: task.dueDate || task.due_date || new Date().toISOString().split('T')[0],
            completed: filterStringToBoolean(task.completed)
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
        const taskId = parseInt(req.params.id);
        const updateFields = { ...req.body };

        // Normalize dueDate to due_date mapping if passed from frontend
        if (updateFields.dueDate !== undefined) {
            updateFields.due_date = updateFields.dueDate;
            delete updateFields.dueDate;
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
            participants: m.participants || "",
            description: m.description || "",
            completed: m.completed
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
            participants: meeting.participants || "",
            description: meeting.description || "",
            completed: filterStringToBoolean(meeting.completed)
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
        const meetingId = parseInt(req.params.id);
        const updateFields = { ...req.body };

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
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Productivity Workspace Backend fully live at http://localhost:${PORT}`);
});