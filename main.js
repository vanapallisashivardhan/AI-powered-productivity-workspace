const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

const WorkspaceCore = {

    // 0. Active User Context Manager
    getAuthToken() {
        return localStorage.getItem(TOKEN_KEY);
    },

    // Default user structure with dynamic fallback derived from saved credentials
    getCurrentUser() {
        const savedUser = JSON.parse(localStorage.getItem(USER_KEY)) || {};
        
        // Dynamic name fallback if none explicitly defined in auth context
        let fallbackName = 'Member';
        if (savedUser.name) {
            fallbackName = savedUser.name;
        } else if (savedUser.email) {
            fallbackName = savedUser.email.split('@')[0];
        }

        const defaultUser = { 
            userId: 'guest', 
            name: fallbackName,
            email: 'member@workspace.local', 
            role: 'Member',
            phone: '',
            location: '',
            bio: '',
            avatar: '' 
        };

        return { ...defaultUser, ...savedUser };
    },

    // Save updated profile to LocalStorage & MongoDB
    async updateProfile(newProfileData) {
        const currentUser = this.getCurrentUser();
        const updatedUser = { ...currentUser, ...newProfileData };
        
        // Save locally
        localStorage.setItem(USER_KEY, JSON.stringify(updatedUser));
        this.updateProfileUI();
        this.renderProfileView();

        // Push update to MongoDB via Express Backend
        try {
            const token = this.getAuthToken();
            if (token) {
                const response = await fetch('http://localhost:3000/api/profile', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(updatedUser)
                });

                if (response.ok) {
                    this.logActivity("Updated user profile details in MongoDB.");
                }
            }
        } catch (err) {
            console.error("MongoDB offline. Saved profile changes to LocalStorage fallback:", err);
            this.logActivity("Updated user profile details locally.");
        }
    },

    getActiveProfileId() {
        const user = this.getCurrentUser();
        return user.userId || 'guest';
    },

    // 1. Core State Matrix Initializer (User-Scoped)
    init() {
        if (!this.checkAuthGuard()) return;

        const pid = this.getActiveProfileId();

        if (!localStorage.getItem(`tasks_${pid}`)) localStorage.setItem(`tasks_${pid}`, JSON.stringify([]));
        if (!localStorage.getItem(`meetings_${pid}`)) localStorage.setItem(`meetings_${pid}`, JSON.stringify([]));
        if (!localStorage.getItem(`settings_${pid}`)) {
            localStorage.setItem(`settings_${pid}`, JSON.stringify({ theme: 'dark', voiceActive: true }));
        }
        if (!localStorage.getItem(`activity_${pid}`)) {
            localStorage.setItem(`activity_${pid}`, JSON.stringify([{ log: `Workspace session initialized for user: ${this.getCurrentUser().email}`, time: new Date().toLocaleString() }]));
        }

        this.applySystemTheme();
        this.syncLiveClock();
        this.updateProfileUI();
        this.dispatchViewSpecificRenders();
        this.initVoiceAssistant();
        this.bindProfileFormEvents();
        const cleanTasks = (this.get('tasks') || []).map(({ priority, category, ...task }) => task);
        const cleanMeetings = (this.get('meetings') || []).map(({ participants, ...meeting }) => meeting);
        this.set('tasks', cleanTasks);
        this.set('meetings', cleanMeetings);
        this.bindGlobalTaskEvents();
        this.initAlarmSystem();
    },

    checkAuthGuard() {
        const currentPath = window.location.pathname.split('/').pop();
        const token = this.getAuthToken();

        if (!token && currentPath !== 'login.html') {
            window.location.href = 'login.html';
            return false;
        } else if (token && currentPath === 'login.html') {
            window.location.href = 'index.html';
            return false;
        }
        return true;
    },

    logout() {
        localStorage.clear();
        window.location.href = 'login.html';
    },

    get(key) { 
        const pid = this.getActiveProfileId();
        return JSON.parse(localStorage.getItem(`${key}_${pid}`)) || []; 
    },

    set(key, data) { 
        const pid = this.getActiveProfileId();
        localStorage.setItem(`${key}_${pid}`, JSON.stringify(data)); 
    },

    // Helper functions for MongoDB Task backend calls
    async saveTaskToBackend(task) {
        try {
            const token = this.getAuthToken();
            if (!token) return;
            await fetch('http://localhost:3000/api/tasks', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(task)
            });
        } catch (e) {
            console.error("Backend offline. Created task locally:", e);
        }
    },

    async updateTaskToBackend(task) {
        try {
            const token = this.getAuthToken();
            if (!token || !task) return;
            await fetch(`http://localhost:3000/api/tasks/${task.id || task._id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(task)
            });
        } catch (e) {
            console.error("Backend offline. Task update saved locally:", e);
        }
    },

    // Helper functions for MongoDB Meeting backend calls
    async saveMeetingToBackend(meeting) {
        try {
            const token = this.getAuthToken();
            if (!token) return;
            await fetch('http://localhost:3000/api/meetings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(meeting)
            });
        } catch (e) {
            console.error("Backend offline. Created meeting locally:", e);
        }
    },

    async updateMeetingToBackend(meeting) {
        try {
            const token = this.getAuthToken();
            if (!token || !meeting) return;
            await fetch(`http://localhost:3000/api/meetings/${meeting.id || meeting._id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(meeting)
            });
        } catch (e) {
            console.error("Backend offline. Meeting update saved locally:", e);
        }
    },

    // Guaranteed task toggle & persistence engine
    async toggleTaskComplete(taskId) {
        if (!taskId) return;

        let tasks = this.get('tasks') || [];
        let updatedTask = null;

        tasks = tasks.map(task => {
            if (task.id == taskId || task._id == taskId) {
                updatedTask = { ...task, completed: !task.completed, overdue: false };
                return updatedTask;
            }
            return task;
        });

        // 1. Immediately update local storage state
        this.set('tasks', tasks);

        // 2. Refresh UI views
        this.dispatchViewSpecificRenders();

        // 3. Sync update to MongoDB via PUT API endpoint
        if (updatedTask) {
            this.logActivity(`${updatedTask.completed ? 'Completed' : 'Reopened'} task: "${updatedTask.title}"`);
            
            try {
                const targetId = updatedTask._id || updatedTask.id;
                await fetch(`http://localhost:3000/api/tasks/${targetId}`, {
                    method: 'PUT',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.getAuthToken()}`
                    },
                    body: JSON.stringify(updatedTask)
                });
            } catch (e) {
                console.error("Backend offline. Saved task toggle to LocalStorage:", e);
            }
        }
    },

    // Guaranteed meeting toggle engine
    async toggleMeetingComplete(meetingId) {
        if (!meetingId) return;

        let meetings = this.get('meetings') || [];
        let updatedMeeting = null;

        meetings = meetings.map(meeting => {
            if (meeting.id == meetingId || meeting._id == meetingId) {
                updatedMeeting = { ...meeting, completed: !meeting.completed, overdue: false };
                return updatedMeeting;
            }
            return meeting;
        });

        this.set('meetings', meetings);
        this.dispatchViewSpecificRenders();

        if (updatedMeeting) {
            this.logActivity(`${updatedMeeting.completed ? 'Completed' : 'Reopened'} meeting: "${updatedMeeting.title}"`);
            
            try {
                const targetId = updatedMeeting._id || updatedMeeting.id;
                await fetch(`http://localhost:3000/api/meetings/${targetId}`, {
                    method: 'PUT',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.getAuthToken()}`
                    },
                    body: JSON.stringify(updatedMeeting)
                });
            } catch (e) {
                console.error("Backend offline. Saved meeting toggle to LocalStorage:", e);
            }
        }
    },

    initAlarmSystem() {
        if (this.alarmTimer) return;
        this.requestNotificationPermission();
        this.checkScheduledItems();
        this.alarmTimer = setInterval(() => this.checkScheduledItems(), 15000);
    },

    async requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            try { await Notification.requestPermission(); } catch (e) {}
        }
    },

    getScheduledDateTime(item) {
        if (!item || (!item.date && !item.dueDate && !item.due_date)) return null;
        const date = item.date || item.dueDate || item.due_date;
        const time = item.time || item.dueTime || item.due_time;
        if ((item.dueDate || item.due_date) && !time) return null;
        const value = new Date(`${date}T${time}`);
        return Number.isNaN(value.getTime()) ? null : value;
    },

    playAlarmSound() {
        try {
            const context = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = context.createOscillator();
            const gain = context.createGain();
            oscillator.frequency.value = 880;
            oscillator.type = 'sine';
            gain.gain.value = 0.12;
            oscillator.connect(gain);
            gain.connect(context.destination);
            oscillator.start();
            setTimeout(() => { oscillator.stop(); context.close(); }, 700);
        } catch (e) {}
    },

    notifyScheduledItem(type, item) {
        const key = `${type}_${item.id || item._id}_${item.date || item.dueDate || item.due_date}_${item.time || item.dueTime || item.due_time || ''}`;
        const notified = this.get('notifications') || [];
        if (notified.includes(key)) return;
        notified.push(key);
        this.set('notifications', notified.slice(-100));
        this.playAlarmSound();
        this.logActivity(`Reminder: ${item.title || 'Scheduled item'} is due now and marked incomplete.`);
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(type === 'task' ? 'Task Reminder' : 'Meeting Reminder', {
                body: `${item.title || 'Scheduled item'} is due now. NOTE: Incomplete`,
                tag: key
            });
        }
    },

    async checkScheduledItems() {
        const now = new Date();
        const tasks = this.get('tasks') || [];
        const meetings = this.get('meetings') || [];
        let tasksChanged = false;
        let meetingsChanged = false;

        for (const task of tasks) {
            const scheduled = this.getScheduledDateTime(task);
            if (!scheduled) continue;
            if (scheduled.getTime() <= now.getTime()) {
                if (!task.overdue) {
                    task.overdue = true;
                    task.completed = false;
                    tasksChanged = true;
                    await this.updateTaskToBackend(task);
                    this.notifyScheduledItem('task', task);
                }
            }
        }

        for (const meeting of meetings) {
            const scheduled = this.getScheduledDateTime(meeting);
            if (!scheduled) continue;
            if (scheduled.getTime() <= now.getTime()) {
                if (!meeting.overdue) {
                    meeting.overdue = true;
                    meeting.completed = false;
                    meetingsChanged = true;
                    await this.updateMeetingToBackend(meeting);
                    this.notifyScheduledItem('meeting', meeting);
                }
            }
        }

        if (tasksChanged) this.set('tasks', tasks);
        if (meetingsChanged) this.set('meetings', meetings);
        if (tasksChanged || meetingsChanged) this.dispatchViewSpecificRenders();
    },

    // Flexible Event Delegation Listener for Checkbox interactions
    bindGlobalTaskEvents() {
        document.addEventListener('change', (e) => {
            const isCheckbox = e.target.type === 'checkbox' || e.target.classList.contains('task-check') || e.target.classList.contains('task-checkbox');
            if (isCheckbox) {
                const taskContainer = e.target.closest('[data-id]') || e.target.closest('.task-item') || e.target.closest('.task-card');
                const taskId = e.target.dataset.id || taskContainer?.dataset?.id;
                if (taskId) {
                    this.toggleTaskComplete(taskId);
                }
            }
        });
    },

    // Updates user details dynamically in Sidebar, Header & Greetings
    updateProfileUI() {
        const user = this.getCurrentUser();

        // Greeting banner on Dashboard
        const greetingBanner = document.getElementById('greeting-banner');
        if (greetingBanner) {
            greetingBanner.innerText = `Welcome back, ${user.name || user.email}`;
        }

        // Sidebar user display bindings
        const sidebarUserName = document.getElementById('sidebar-user-name');
        if (sidebarUserName) {
            sidebarUserName.innerText = user.name || user.email || 'Member';
        }

        // Sidebar Avatar Image / Icon Handling
        const sidebarAvatarImg = document.getElementById('sidebar-avatar-img');
        const sidebarAvatarIcon = document.getElementById('sidebar-avatar-icon');
        if (sidebarAvatarImg && sidebarAvatarIcon) {
            if (user.avatar) {
                sidebarAvatarImg.src = user.avatar;
                sidebarAvatarImg.style.display = 'block';
                sidebarAvatarIcon.style.display = 'none';
            } else {
                sidebarAvatarImg.style.display = 'none';
                sidebarAvatarIcon.style.display = 'block';
            }
        }

        // Logout Button Handler in Sidebar
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.onclick = () => this.logout();
        }

        // Profile Avatar & Menu in Navbar (if applicable)
        const profileContainer = document.getElementById('navbar-profile-selector');
        if (profileContainer) {
            profileContainer.innerHTML = `
                <div class="profile-selector-wrapper" style="display:flex; align-items:center; gap: 12px;">
                    <div style="width: 36px; height: 36px; border-radius: 50%; background-color: #3b82f6; display: flex; align-items: center; justify-content: center; color: #fff; overflow:hidden;">
                        ${user.avatar ? `<img src="${user.avatar}" style="width:100%; height:100%; object-fit:cover;" />` : `<i class="fa-solid fa-user"></i>`}
                    </div>
                    <div style="display:flex; flex-direction:column; align-items:flex-start;">
                        <span style="font-weight:600; font-size:0.85rem; color:var(--text-primary, #fff);">${user.name || 'User'}</span>
                        <span style="font-size:0.72rem; color:var(--text-secondary, #a1a1aa);">${user.role || 'Member'}</span>
                    </div>
                    <button onclick="WorkspaceCore.logout()" title="Logout" style="background:#ef4444; color:white; border:none; padding:6px 10px; border-radius:6px; cursor:pointer; font-size:0.8rem; margin-left: 6px;">
                        <i class="fa-solid fa-right-from-bracket"></i>
                    </button>
                </div>
            `;
        }
    },

    logActivity(text) {
        let logs = this.get('activity') || [];
        logs.unshift({ log: text, time: new Date().toLocaleString() });
        this.set('activity', logs.slice(0, 15));
        this.dispatchViewSpecificRenders();
    },

    computeProductivityScore() {
        const tasks = this.get('tasks') || [];
        const meetings = this.get('meetings') || [];       
        const completedTasks = tasks.filter(t => t.completed).length;
        const completedMeetings = meetings.filter(m => m.completed).length;
        const totalActiveItems = tasks.length + meetings.length;

        if (totalActiveItems === 0) return 0;
        return Math.round(((completedTasks + completedMeetings) / totalActiveItems) * 100);
    },

    applySystemTheme() {
        const settings = this.get('settings') || { theme: 'dark' };
        document.documentElement.setAttribute('data-theme', settings.theme);
        
        const checkbox = document.getElementById('theme-toggle-checkbox');
        if (checkbox) checkbox.checked = (settings.theme === 'dark');
    },

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

    // Dynamic router dispatcher including Profile Page/Section render
    dispatchViewSpecificRenders() {
        const currentPath = window.location.pathname.split('/').pop();
        
        if (currentPath === 'index.html' || currentPath === '' || currentPath === 'dashboard.html') {
            this.renderDashboardView();
        } else if (currentPath === 'tasks.html') {
            if (typeof renderTaskCollection === 'function') renderTaskCollection();
        } else if (currentPath === 'meetings.html') {
            if (typeof renderMeetingAgenda === 'function') renderMeetingAgenda();
        } else if (currentPath === 'profile.html') {
            this.renderProfileView();
        }
    },

    // Renders and populates data on profile.html if open
    renderProfileView() {
        const user = this.getCurrentUser();

        const displayName = document.getElementById('profile-display-name');
        if (displayName) displayName.innerText = user.name || user.email;

        const displayRole = document.getElementById('profile-role-badge') || document.getElementById('profile-display-role');
        if (displayRole) displayRole.innerText = user.role || 'Member';

        const nameInput = document.getElementById('full-name') || document.getElementById('profile-name-input');
        if (nameInput) nameInput.value = user.name || '';

        const emailInput = document.getElementById('email') || document.getElementById('profile-email-input');
        if (emailInput) emailInput.value = user.email || '';

        const roleInput = document.getElementById('job-title') || document.getElementById('profile-role-input');
        if (roleInput) roleInput.value = user.role || '';

        const phoneInput = document.getElementById('phone-number') || document.getElementById('profile-phone-input');
        if (phoneInput) phoneInput.value = user.phone || '';

        const locationInput = document.getElementById('work-location') || document.getElementById('profile-location-input');
        if (locationInput) locationInput.value = user.location || '';

        const bioInput = document.getElementById('bio') || document.getElementById('profile-bio-input');
        if (bioInput) bioInput.value = user.bio || '';

        // Handle Main Card Profile Avatar Preview
        const profileAvatarImg = document.getElementById('profile-avatar-img');
        const profileAvatarIcon = document.getElementById('profile-avatar-icon');
        if (profileAvatarImg && profileAvatarIcon) {
            if (user.avatar) {
                profileAvatarImg.src = user.avatar;
                profileAvatarImg.style.display = 'block';
                profileAvatarIcon.style.display = 'none';
            } else {
                profileAvatarImg.style.display = 'none';
                profileAvatarIcon.style.display = 'block';
            }
        }
    },

    bindProfileFormEvents() {
        const profileForm = document.getElementById('profile-form');
        if (profileForm) {
            profileForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                if (typeof window.saveUserProfileForm === 'function') {
                    await window.saveUserProfileForm(e);
                }
            });
        }

        // Bind Photo Upload Button and File Input Handler
        const changeAvatarBtn = document.getElementById('change-avatar-btn');
        const avatarFileInput = document.getElementById('avatar-file-input');

        if (changeAvatarBtn && avatarFileInput) {
            changeAvatarBtn.addEventListener('click', () => avatarFileInput.click());

            avatarFileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = async (event) => {
                        const base64Image = event.target.result;
                        await WorkspaceCore.updateProfile({ avatar: base64Image });
                        alert("Profile photo updated successfully!");
                    };
                    reader.readAsDataURL(file);
                }
            });
        }
    },

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
            voiceBtn.onclick = null;
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
                const tasks = this.get('tasks') || [];
                const meetings = this.get('meetings') || [];
                const currentPath = window.location.pathname.split('/').pop();

                const compTasks = tasks.filter(t => t.completed).length;
                const pendTasks = tasks.filter(t => !t.completed).length;
                const compMeetings = meetings.filter(m => m.completed).length;
                const pendMeetings = meetings.filter(m => !m.completed).length;
                const grandTotal = tasks.length + meetings.length;
                const compositeScore = grandTotal === 0 ? 0 : Math.round(((compTasks + compMeetings) / grandTotal) * 100);

                const currentDataState = {
                    currentDate: new Date().toISOString().split('T')[0],
                    currentTime: new Date().toLocaleTimeString(),
                    activePageView: currentPath || 'index.html',
                    activeUserId: this.getActiveProfileId(),
                    userProfile: this.getCurrentUser(),
                    tasks: tasks,
                    meetings: meetings
                };

                const response = await fetch('http://localhost:3000/api/voice-command', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.getAuthToken()}`
                    },
                    body: JSON.stringify({ 
                        transcript,
                        currentState: currentDataState 
                    })
                });

                if (response.status === 401) {
                    this.logout();
                    return;
                }

                if (!response.ok) throw new Error("Network layer routing failure.");
                const data = await response.json();
                
                await this.executeVoiceIntent(data, speakText);

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
                    const newTask = {
                        id: Date.now().toString(),
                        title: data.title,
                        dueDate: data.dueDate || new Date().toISOString().split('T')[0],
                        completed: false
                    };
                    tasks.push(newTask);
                    this.set('tasks', tasks);
                    this.logActivity(`Created task: "${data.title}"`);
                    await this.saveTaskToBackend(newTask);
                    if (speakCallback) speakCallback(`Added task: ${data.title}`);
                }
                break;

            case "COMPLETE_TASK":
                if (data.title) {
                    let matchedTask = tasks.find(t => t.title.toLowerCase().includes(data.title.toLowerCase()));
                    if (matchedTask) {
                        await this.toggleTaskComplete(matchedTask.id || matchedTask._id);
                        if (speakCallback) speakCallback(`Completed task: ${matchedTask.title}`);
                    }
                }
                break;

            case "DELETE_TASK":
                if (data.title) {
                    const matchedTask = tasks.find(t => t.title.toLowerCase().includes(data.title.toLowerCase()));
                    if (matchedTask) {
                        tasks = tasks.filter(t => t.id !== matchedTask.id && t._id !== matchedTask._id);
                        this.set('tasks', tasks);
                        if (typeof window.deleteTaskRecordBackend === 'function') {
                            await window.deleteTaskRecordBackend(matchedTask.id || matchedTask._id);
                        }
                        this.logActivity(`Deleted task: "${data.title}"`);
                        if (speakCallback) speakCallback(`Deleted task: ${data.title}`);
                    }
                }
                break;

            case "CREATE_MEETING":
                if (data.title) {
                    const newMeeting = {
                        id: Date.now().toString(),
                        title: data.title,
                        date: data.date || new Date().toISOString().split('T')[0],
                        time: data.time || "12:00",
                        description: data.description || "",
                        completed: false
                    };
                    meetings.push(newMeeting);
                    this.set('meetings', meetings);
                    this.logActivity(`Scheduled meeting: "${data.title}"`);
                    await this.saveMeetingToBackend(newMeeting);
                    if (speakCallback) speakCallback(`Meeting scheduled: ${data.title}`);
                }
                break;

            case "COMPLETE_MEETING":
                if (data.title) {
                    let matchedMeeting = meetings.find(m => m.title.toLowerCase().includes(data.title.toLowerCase()));
                    if (matchedMeeting) {
                        await this.toggleMeetingComplete(matchedMeeting.id || matchedMeeting._id);
                        if (speakCallback) speakCallback(`Marked meeting ${matchedMeeting.title} as completed.`);
                    }
                }
                break;

            case "DELETE_MEETING":
                if (data.title) {
                    const matchedMeeting = meetings.find(m => m.title.toLowerCase().includes(data.title.toLowerCase()));
                    if (matchedMeeting) {
                        meetings = meetings.filter(m => m.id !== matchedMeeting.id && m._id !== matchedMeeting._id);
                        this.set('meetings', meetings);
                        if (typeof window.deleteMeetingRecordBackend === 'function') {
                            await window.deleteMeetingRecordBackend(matchedMeeting.id || matchedMeeting._id);
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
                }
                break;

            default:
                if (speakCallback) speakCallback("Action received, but no handler was configured.");
                break;
        }
    }
};

// Global delete meeting backend signature export
window.deleteMeetingRecordBackend = async function(id) {
    try {
        const token = WorkspaceCore.getAuthToken();
        if (!token) return;
        await fetch(`http://localhost:3000/api/meetings/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
    } catch (err) {
        console.error("Error connecting to backend meeting deletion route:", err);
    }
};

// Global delete task backend signature export
window.deleteTaskRecordBackend = async function(id) {
    try {
        const token = WorkspaceCore.getAuthToken();
        if (!token) return;
        await fetch(`http://localhost:3000/api/tasks/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
    } catch (err) {
        console.error("Error connecting to backend task deletion route:", err);
    }
};

// Initialize application lifecycle on DOM Load
document.addEventListener('DOMContentLoaded', () => {
    WorkspaceCore.init();
});