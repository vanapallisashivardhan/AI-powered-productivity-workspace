/**
 * AI-Powered Productivity Workspace - Core Engineering Engine (js/main.js)
 * Fully functional, zero dependencies, persistent LocalStorage State Machine.
 */

const WorkspaceCore = {
    // 1. Core State Matrix Initializer
    init() {
        // Unify storage keys across all sub-pages completely
        if (!localStorage.getItem('tasks')) localStorage.setItem('tasks', JSON.stringify([]));
        if (!localStorage.getItem('meetings')) localStorage.setItem('meetings', JSON.stringify([]));
        if (!localStorage.getItem('settings')) {
            localStorage.setItem('settings', JSON.stringify({ theme: 'dark', voiceActive: true }));
        }
        if (!localStorage.getItem('activity')) {
            localStorage.setItem('activity', JSON.stringify([{ log: 'Workspace OS initialized.', time: new Date().toLocaleString() }]));
        }
        
        this.applySystemTheme();
        this.syncLiveClock();
        this.dispatchViewSpecificRenders();
        this.initVoiceAssistant(); // Fire up voice processing listener
    },

    // 2. LocalStorage Data Access Layer Getter/Setter Pairs
    get(key) { return JSON.parse(localStorage.getItem(key)); },
    set(key, data) { localStorage.setItem(key, JSON.stringify(data)); },

    // 3. System Auditing Trail Log Mutator
    logActivity(text) {
        let logs = this.get('activity') || [];
        logs.unshift({ log: text, time: new Date().toLocaleString() });
        this.set('activity', logs.slice(0, 15)); // Keep running log history buffer of 15 items Max
        this.dispatchViewSpecificRenders(); // Re-render visual components automatically
    },

    // 4. Productivity Formula Architecture Core Validation Node
    computeProductivityScore() {
        const tasks = this.get('tasks') || [];
        const meetings = this.get('meetings') || [];
        
        const completedTasks = tasks.filter(t => t.completed).length;
        const completedMeetings = meetings.filter(m => m.completed).length;
        const totalActiveItems = tasks.length + meetings.length;

        if (totalActiveItems === 0) return 0;
        return Math.round(((completedTasks + completedMeetings) / totalActiveItems) * 100);
    },

    // 5. Visual Theme Renderer Engine
    applySystemTheme() {
        const settings = this.get('settings') || { theme: 'dark' };
        document.documentElement.setAttribute('data-theme', settings.theme);
        
        const checkbox = document.getElementById('theme-toggle-checkbox');
        if (checkbox) checkbox.checked = (settings.theme === 'dark');
    },

    // 6. Live Clock Data Synchronization Mechanism
    syncLiveClock() {
        const clockEl = document.getElementById('live-clock');
        const dateEl = document.getElementById('live-date');
        
        function tick() {
            const d = new Date();
            if (clockEl) clockEl.innerText = d.toLocaleTimeString();
            if (dateEl) dateEl.innerText = d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        }
        if (clockEl || dateEl) { setInterval(tick, 1000); tick(); }
    },

    // 7. View Dispatch Router Module
    dispatchViewSpecificRenders() {
        const currentPath = window.location.pathname.split('/').pop();
        
        if (currentPath === 'index.html' || currentPath === '') {
            this.renderDashboardView();
        } else if (currentPath === 'tasks.html') {
            if (typeof renderTaskCollection === 'function') renderTaskCollection();
        } else if (currentPath === 'meetings.html') {
            if (typeof renderMeetingAgenda === 'function') renderMeetingAgenda();
        } else if (currentPath === 'analysis.html') {
            if (typeof AnalysisEngine === 'object') AnalysisEngine.computeAndRenderMetrics();
        }
    },

    // 8. View Sub-Renderer - Dashboard Layout Sync Data Pump
    renderDashboardView() {
        const tasks = this.get('tasks') || [];
        const meetings = this.get('meetings') || [];
        
        const pendingTasksCount = tasks.filter(t => !t.completed).length;
        const completedTasksCount = tasks.filter(t => t.completed).length;
        const upcomingMeetingsCount = meetings.filter(m => !m.completed).length;
        const productivityScore = this.computeProductivityScore();

        if (document.getElementById('dash-pending-tasks')) document.getElementById('dash-pending-tasks').innerText = pendingTasksCount;
        if (document.getElementById('dash-completed-tasks')) document.getElementById('dash-completed-tasks').innerText = completedTasksCount;
        if (document.getElementById('dash-meetings-count')) document.getElementById('dash-meetings-count').innerText = upcomingMeetingsCount;
        if (document.getElementById('dash-productivity-score')) document.getElementById('dash-productivity-score').innerText = productivityScore + '%';

        const logContainer = document.getElementById('recent-activity-log');
        if (logContainer) {
            const logs = this.get('activity') || [];
            logContainer.innerHTML = logs.slice(0, 4).map(l => `
                <div class="list-item">
                    <div><strong>${l.log}</strong></div>
                    <div style="font-size:0.75rem; color:var(--text-secondary);">${l.time}</div>
                </div>
            `).join('');
        }

        const meetingContainer = document.getElementById('dash-meetings-list');
        if (meetingContainer) {
            const upcoming = meetings.filter(m => !m.completed).slice(0, 3);
            if (upcoming.length === 0) {
                meetingContainer.innerHTML = '<div style="color:var(--text-secondary); font-size:0.9rem;">No upcoming sessions scheduled</div>';
            } else {
                meetingContainer.innerHTML = upcoming.map(m => `
                    <div class="list-item" style="border-left-color: #8b5cf6;">
                        <div><strong>${m.title}</strong><br><span style="font-size:0.8rem;color:var(--text-secondary);">${m.date} | ${m.time}</span></div>
                    </div>
                `).join('');
            }
        }

        const ctxEl = document.getElementById('dashboardPreviewChart');
        if (ctxEl && typeof Chart !== 'undefined') {
            const ctx = ctxEl.getContext('2d');
            if (window.dashChartInstance) window.dashChartInstance.destroy();
            window.dashChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: ['Completed', 'Pending', 'Meetings'],
                    datasets: [{
                        data: [completedTasksCount, pendingTasksCount, meetings.length],
                        backgroundColor: ['#10b981', '#3b82f6', '#8b5cf6'],
                        borderRadius: 6
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
            });
        }
    },

    // 9. Speech Recognition Hardware Core Connector
    initVoiceAssistant() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.error("Speech recognition engine not supported in this browser environment.");
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = true; 
        recognition.lang = 'en-US';
        recognition.interimResults = false;

        const voiceBtn = document.getElementById('voice-activation-trigger') || document.getElementById('voice-start-btn');
        const voiceToast = document.getElementById('voice-toast');
        const toastText = document.getElementById('voice-toast-text');

        let isEngineExplicitlyOff = localStorage.getItem('ws_mic_active') === 'true' ? false : true;

        const updateVoiceUI = (state, customText = "") => {
            if (state === 'listening') {
                if (voiceBtn) voiceBtn.classList.add('listening');
                if (voiceToast) voiceToast.style.display = 'flex';
                if (toastText) toastText.innerText = "Listening continuously...";
            } else if (state === 'processing') {
                if (voiceToast) voiceToast.style.display = 'flex';
                if (toastText) toastText.innerText = customText || "Processing...";
            } else {
                if (voiceBtn) voiceBtn.classList.remove('listening');
                if (voiceToast) voiceToast.style.display = 'none';
            }
        };

        const speakText = (text) => {
            if (!window.speechSynthesis) return;
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.onstart = () => recognition.stop();
            utterance.onend = () => { if (!isEngineExplicitlyOff) try { recognition.start(); } catch(e){} };
            window.speechSynthesis.speak(utterance);
        };

        if (voiceBtn) {
            voiceBtn.addEventListener('click', () => {
                isEngineExplicitlyOff = !isEngineExplicitlyOff;
                localStorage.setItem('ws_mic_active', !isEngineExplicitlyOff);
                if (isEngineExplicitlyOff) {
                    recognition.stop();
                    updateVoiceUI('idle');
                } else {
                    try { recognition.start(); } catch(e){}
                }
            });
        }

        recognition.onstart = () => updateVoiceUI('listening');
        recognition.onerror = (e) => { console.warn("Speech recognition warning:", e.error); };
        recognition.onend = () => { if (!isEngineExplicitlyOff) try { recognition.start(); } catch(e){} else updateVoiceUI('idle'); };

        recognition.onresult = async (event) => {
            const latestResultIndex = event.resultIndex;
            const transcript = event.results[latestResultIndex][0].transcript.trim();
            if (!transcript) return;

            this.logActivity(`Processing phrase: "${transcript}"`);
            updateVoiceUI('processing', "Analyzing intent...");

            try {
                const currentDataState = {
                    currentDate: new Date().toISOString().split('T')[0],
                    currentTime: new Date().toLocaleTimeString(),
                    tasks: this.get('tasks') || [],
                    meetings: this.get('meetings') || []
                };

                const response = await fetch('http://localhost:3000/api/voice-command', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        transcript,
                        currentState: currentDataState 
                    })
                });

                if (!response.ok) throw new Error("Network layer routing failure.");
                const data = await response.json();
                
                this.executeVoiceIntent(data, speakText);

            } catch (err) {
                console.error("Voice routing error:", err);
                this.logActivity("System error: Unable to map semantic command intent.");
                speakText("Sorry, I had trouble parsing that command.");
            }
            
            if (!isEngineExplicitlyOff) updateVoiceUI('listening');
        };

        if (!isEngineExplicitlyOff) {
            setTimeout(() => { try { recognition.start(); } catch(e){} }, 600);
        }
    },

    // 10. Semantic Intent Execution Router Engine
    async executeVoiceIntent(data, speakCallback) {
        if (!data || data.action === "UNKNOWN") {
            this.logActivity("Command execution failed: Unrecognized intent matching rules.");
            if (speakCallback) speakCallback("I am not sure how to handle that workspace request yet.");
            return;
        }

        let tasks = this.get('tasks') || [];
        let meetings = this.get('meetings') || [];

        switch (data.action) {
            case "NAVIGATE":
                if (data.targetPage) {
                    this.logActivity(`Redirecting view state matrix to: ${data.targetPage}`);
                    if (speakCallback) speakCallback(`Opening ${data.targetPage.replace('.html', '')}.`);
                    setTimeout(() => window.location.href = data.targetPage, 800);
                }
                break;

            case "CREATE_TASK":
                if (data.title) {
                    tasks.unshift({
                        id: Date.now(),
                        title: data.title,
                        dueDate: data.dueDate || new Date().toISOString().split('T')[0],
                        completed: false
                    });
                    this.set('tasks', tasks);
                    this.logActivity(`Created task: ${data.title}`);
                    if (speakCallback) speakCallback(`Added task: ${data.title}`);
                }
                break;

            case "COMPLETE_TASK":
                if (data.title) {
                    let taskFound = false;
                    tasks = tasks.map(t => {
                        if (t.title.toLowerCase().includes(data.title.toLowerCase())) {
                            taskFound = true;
                            return { ...t, completed: true };
                        }
                        return t;
                    });
                    if (taskFound) {
                        this.set('tasks', tasks);
                        this.logActivity(`Completed task: "${data.title}"`);
                        if (speakCallback) speakCallback(`Completed task: ${data.title}`);
                    }
                }
                break;

            case "DELETE_TASK":
                if (data.title) {
                    const originalLength = tasks.length;
                    tasks = tasks.filter(t => !t.title.toLowerCase().includes(data.title.toLowerCase()));
                    if (tasks.length < originalLength) {
                        this.set('tasks', tasks);
                        this.logActivity(`Deleted task: "${data.title}"`);
                        if (speakCallback) speakCallback(`Deleted task: ${data.title}`);
                    }
                }
                break;

            case "CREATE_MEETING":
                if (data.title) {
                    meetings.unshift({
                        id: Date.now(),
                        title: data.title,
                        date: data.date || new Date().toISOString().split('T')[0],
                        time: data.time || "12:00",
                        completed: false
                    });
                    this.set('meetings', meetings);
                    this.logActivity(`Scheduled session: ${data.title}`);
                    if (speakCallback) speakCallback(`Meeting scheduled: ${data.title}`);
                }
                break;
            case "COMPLETE_MEETING":
                if (data.title) {
                    let meetingFound = false;
                    meetings = meetings.map(m => {
                        if (m.title.toLowerCase().includes(data.title.toLowerCase())) {
                            meetingFound = true;
                            return { ...m, completed: true };
                        }
                        return m;
                    });
                    if (meetingFound) {
                        this.set('meetings', meetings);
                        this.logActivity(`Completed meeting: "${data.title}"`);
                        if (speakCallback) speakCallback(`Marked meeting ${data.title} as completed.`);
                    }
                }
                break;

            case "DELETE_MEETING":
                if (data.title) {
                    const matchedMeeting = meetings.find(m => m.title.toLowerCase().includes(data.title.toLowerCase()));
                    if (matchedMeeting) {
                        if (typeof window.deleteMeetingRecordSupabase === 'function') {
                            await window.deleteMeetingRecordSupabase(matchedMeeting.id);
                        } else {
                            meetings = meetings.filter(m => m.id !== matchedMeeting.id);
                            this.set('meetings', meetings);
                        }
                        this.logActivity(`Deleted meeting: "${data.title}"`);
                        if (speakCallback) speakCallback(`Deleted meeting ${data.title}.`);
                    }
                }
                break;
            case "CHANGE_THEME":
                if (data.themeChange) {
                    let settings = this.get('settings') || {};
                    settings.theme = data.themeChange;
                    this.set('settings', settings);
                    this.applySystemTheme();
                    this.logActivity(`Visual template transformed to ${data.themeChange} profile.`);
                    if (speakCallback) speakCallback(`Switching to ${data.themeChange} mode.`);
                }
                break;

            case "SEARCH":
                if (data.searchQuery) {
                    const searchInput = document.getElementById('global-search') || document.getElementById('global-search-input');
                    if (searchInput) {
                        searchInput.value = data.searchQuery;
                        searchInput.dispatchEvent(new Event('input'));
                        if (speakCallback) speakCallback(`Searching for ${data.searchQuery}`);
                    }
                }
                break;

            case "ANSWER_QUESTION":
                if (data.aiResponseText) {
                    if (speakCallback) speakCallback(data.aiResponseText);
                    alert(`🎙️ AI Assistant:\n\n"${data.aiResponseText}"`);
                }
                break;
        }
        
        this.dispatchViewSpecificRenders();
        if (typeof renderTaskCollection === 'function') renderTaskCollection();
        if (typeof renderMeetingAgenda === 'function') renderMeetingAgenda();
        if (typeof refreshDashboardVisuals === 'function') refreshDashboardVisuals();
    }
};

// ==========================================================
// SUPABASE SYNCHRONIZATION OVERRIDES FOR WORKSPACE (REFINED)
// ==========================================================
if (typeof WorkspaceCore !== 'undefined') {
    
    // 1. Sync Down from Cloud Database Engine Safely Bypass Interceptor Loop
    WorkspaceCore.syncWithSupabase = async function() {
        try {
            const taskRes = await fetch('http://localhost:3000/api/tasks');
            const cloudTasks = await taskRes.json();
            
            const formattedTasks = cloudTasks.map(t => ({
                id: Number(t.id),
                title: t.title,
                priority: t.priority || "medium",
                category: t.category || "General",
                dueDate: t.due_date || t.dueDate || "",
                completed: t.completed === true || t.completed === 'true'
            }));
            localStorage.setItem('tasks', JSON.stringify(formattedTasks));

            const meetRes = await fetch('http://localhost:3000/api/meetings');
            const cloudMeets = await meetRes.json();
            
            const formattedMeets = cloudMeets.map(m => ({
                id: Number(m.id),
                title: m.title,
                date: m.date,
                time: m.time,
                participants: m.participants || "",
                description: m.description || "",
                completed: m.completed === true || m.completed === 'true'
            }));
            localStorage.setItem('meetings', JSON.stringify(formattedMeets));

            this.dispatchViewSpecificRenders();
            if (typeof renderTaskCollection === 'function') renderTaskCollection();
            if (typeof renderMeetingAgenda === 'function') renderMeetingAgenda();
            if (typeof refreshDashboardVisuals === 'function') refreshDashboardVisuals();
        } catch (e) {
            console.error("Failed downloading operational dataset from Supabase backend layer:", e);
        }
    };

    // 2. Wrap Init Core Execution Chain (Safe Mode)
    const baseInit = WorkspaceCore.init;
    WorkspaceCore.init = async function() {
        try {
            await this.syncWithSupabase();
        } catch(e) {
            console.error("Supabase dynamic mapping bypassed due to local initialization errors:", e);
        }
        // ALWAYS run base initialization, guaranteeing voice activation executes regardless of backend connectivity
        baseInit.apply(this, arguments);
    };

    // 3. Intercept Local Mutations to Update Cloud Layer safely
    const baseSet = WorkspaceCore.set;
    WorkspaceCore.set = async function(key, data) {
        baseSet.apply(this, arguments);
        
        if (key === 'tasks' || key === 'meetings') {
            for (let record of data) {
                try {
                    let bodyPayload = { ...record };
                    if (key === 'tasks' && record.dueDate) {
                        bodyPayload.dueDate = record.dueDate;
                    }
                    
                    await fetch(`http://localhost:3000/api/${key}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(bodyPayload)
                    });
                } catch(err) {
                    console.error(`Offline delay storing structural entity inside ${key} channel`);
                }
            }
        }
    };

    // 4. Overwrite Core Network Deletions safely
    window.deleteTaskRecordSupabase = async function(id) {
        try {
            await fetch(`http://localhost:3000/api/tasks/${id}`, { method: 'DELETE' });
            let tasks = WorkspaceCore.get('tasks') || [];
            tasks = tasks.filter(t => Number(t.id) !== Number(id));
            baseSet.apply(WorkspaceCore, ['tasks', tasks]);
            if (typeof renderTaskCollection === 'function') renderTaskCollection();
            WorkspaceCore.dispatchViewSpecificRenders();
        } catch(e) { console.error(e); }
    };

    window.deleteMeetingRecordSupabase = async function(id) {
        try {
            await fetch(`http://localhost:3000/api/meetings/${id}`, { method: 'DELETE' });
            let meetings = WorkspaceCore.get('meetings') || [];
            meetings = meetings.filter(m => Number(m.id) !== Number(id));
            baseSet.apply(WorkspaceCore, ['meetings', meetings]);
            if (typeof renderMeetingAgenda === 'function') renderMeetingAgenda();
            WorkspaceCore.dispatchViewSpecificRenders();
        } catch(e) { console.error(e); }
    };

    // 5. Automatic Background Offline to Online Syncer
    window.addEventListener('online', async () => {
        console.log("🌐 Connection restored! Syncing local items to Supabase cloud layer...");
        WorkspaceCore.syncWithSupabase();
    });
}

// Global Event listener hook definition
window.addEventListener('DOMContentLoaded', () => WorkspaceCore.init());