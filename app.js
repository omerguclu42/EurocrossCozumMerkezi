document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const views = {
        login: document.getElementById('login-view'),
        loading: document.getElementById('loading-view'),
        dashboard: document.getElementById('dashboard-view'),
        opinions: document.getElementById('opinions-view'),
        reports: document.getElementById('reports-view')
    };

    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const welcomeModal = document.getElementById('welcome-modal');
    const welcomeOkBtn = document.getElementById('welcome-ok-btn');
    const dontShowAgainCheckbox = document.getElementById('dont-show-again');
    const logoutBtn = document.getElementById('logout-btn');


    // TEMPORARY ONE-TIME WIPE SCRIPT (Requested by User)
    if (!localStorage.getItem('eurocross_wiped_v1')) {
        localStorage.removeItem('eurocross_complaints');
        localStorage.setItem('eurocross_wiped_v1', 'true');
        console.log("Test verileri (şikayetler) kullanıcının talebi üzerine bir kereliğine sıfırlandı.");
    }

    // -- Global Data Bases --
    let employeeData = [];
    let clientUsersData = [];
    let complaintTypesData = [];
    let callCustomersData = [];
    let serviceFilesData = [];
    let globalUser = null; 

    // Pagination & Sorting States
    let srvPage = 1;
    let callPage = 1;
    let clientPage = 1;
    const PAGE_SIZE = 10;
    let srvSort = { key: 'date', dir: 'desc' };
    let callSort = { key: 'date', dir: 'desc' };
    let clientSort = { key: 'date', dir: 'desc' };
    
    // Opinions View States
    let opSrvPage = 1;
    let opCallPage = 1;
    let opClientPage = 1;
    let opDoneSrvPage = 1;
    let opDoneCallPage = 1;
    let opDoneClientPage = 1;

    let opSrvSort = { key: 'caseDate', dir: 'desc' };
    let opCallSort = { key: 'date', dir: 'desc' };
    let opClientSort = { key: 'date', dir: 'desc' };
    let opDoneSrvSort = { key: 'caseDate', dir: 'desc' };
    let opDoneCallSort = { key: 'date', dir: 'desc' };
    let opDoneClientSort = { key: 'date', dir: 'desc' };

    // Load local complaints
    let savedComplaints = JSON.parse(localStorage.getItem('eurocross_complaints') || '[]');

    // Migrate old CMP- IDs to EC2026 format
    let migrated = false;
    savedComplaints.forEach((c) => {
        if (c.id && c.id.startsWith('CMP')) {
            const year = new Date().getFullYear();
            const prefix = `EC${year}`;
            const yearComplaints = savedComplaints.filter(x => x.id && x.id.startsWith(prefix) && x.id !== c.id);
            let maxNum = 0;
            yearComplaints.forEach(x => {
                const num = parseInt(x.id.replace(prefix, ''), 10);
                if (!isNaN(num) && num > maxNum) maxNum = num;
            });
            c.id = `${prefix}${(maxNum + 1).toString().padStart(7, '0')}`;
            migrated = true;
        }
    });
    if (migrated) localStorage.setItem('eurocross_complaints', JSON.stringify(savedComplaints));

    // --- Safe Storage & Auto-Cleanup Logic ---
    function saveComplaintsSafely() {
        try {
            localStorage.setItem('eurocross_complaints', JSON.stringify(savedComplaints));
            return true;
        } catch (e) {
            // Quota Exceeded! Let's try to free up space by deleting attached files of completed or oldest complaints.
            let freedSpace = false;
            // 1st Pass: Strip attachments from 'Şikayet Sonuçlandı' opinion requests
            for (let i = 0; i < savedComplaints.length; i++) {
                const c = savedComplaints[i];
                if (c.status === 'Şikayet Sonuçlandı' && c.data && c.data.opinionRequests) {
                    c.data.opinionRequests.forEach(req => {
                        if (req.reply && req.reply.file && req.reply.file.data) {
                            delete req.reply.file.data;
                            req.reply.file.note = "(Dosya içeriği yer açmak için silindi)";
                            freedSpace = true;
                        }
                    });
                }
                if (freedSpace) break;
            }
            if (!freedSpace) {
                // 2nd Pass: Strip attachments from oldest complaints' initial files
                for (let i = 0; i < savedComplaints.length; i++) {
                    const c = savedComplaints[i];
                    if (c.files && c.files.length > 0) {
                        let hasData = false;
                        c.files.forEach(f => {
                            if (f.data) {
                                delete f.data;
                                f.name += " (Veri Silindi)";
                                hasData = true;
                                freedSpace = true;
                            }
                        });
                        if (hasData) break;
                    }
                }
            }

            if (freedSpace) {
                return saveComplaintsSafely(); // Retry
            } else {
                alert('Kritik Hata: Tarayıcı hafızası tamamen dolu. Eski kayıtları silmeniz gerekebilir.');
                return false;
            }
        }
    }

    // No user-specific logic remaining

    // -- Google Sheets IDs --
    const SHEETS = {
        EMPLOYEES: '1LkF0YDoYUyv8qHjVaXQskyRneAIWYxTd2tGz3Ogv_Eo',
        CLIENT_USERS: '1tU2RGcza56XWxv8tkjQC6-xVCVKxJWyNKAqSgWQbDD8',
        COMPLAINT_TYPES: '1GMkMdaQGH_M3sk-xxeq6b_DKqcoH9m4wcPEM7EahAxs',
        CALL_CUSTOMERS: '1Gtk9vwprBGmnASeIFMB3cAnX7sCL6BAz8Ze_4xGETEc',
        SERVICE_FILES: '1tTTycim_hfJV7on77KzQuCaSJ8X5WFlKCCM0Ls3vN5M'
    };

    // Generic JSONP Fetcher for Google Visualization API
    function fetchJSONP(sheetId, callbackName, onSuccess) {
        // Force headers=1 so the first row is always treated as labels, break cache with timestamp
        const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json;responseHandler:${callbackName}&headers=1&t=${Date.now()}`;
        
        window[callbackName] = function (json) {
            if (!json || !json.table || !json.table.cols || !json.table.rows) {
                console.warn(`${callbackName} fetching failed or invalid data.`);
                onSuccess([]);
                return;
            }

            const cols = json.table.cols;
            const rows = json.table.rows;
            
            // Sometimes visualization API still leaves label empty if it's considered data.
            // Let's create a robust header map from cols.label or fallback to first row if needed.
            let headers = cols.map((col, index) => col.label ? col.label.trim() : `Col${index}`);

            // If headers are mostly empty (e.g. "Col0", "Col1"), use the first row of data as headers
            if (headers.filter(h => h.startsWith('Col')).length > (headers.length / 2) && rows.length > 0) {
                headers = rows[0].c.map((cell, index) => cell && cell.v ? cell.v.toString().trim() : `Col${index}`);
                rows.shift(); // Remove the first row since it's now our headers
            }
            
            const parsedArray = rows.map(row => {
                let rowObj = {};
                row.c.forEach((cell, index) => {
                    const header = headers[index];
                    if (header) {
                        rowObj[header] = cell ? cell.v : '';
                    }
                });
                return rowObj;
            });

            onSuccess(parsedArray);
        };

        const script = document.createElement('script');
        script.src = url;
        script.onerror = () => {
            console.error(`Error loading JSONP script for ${callbackName}`);
            onSuccess([]);
        };
        document.body.appendChild(script);
    }

    // --- EMAIL NOTIFICATION SYSTEM ---
    // (EmailJS implementation removed per user request)
    document.querySelectorAll('th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const prop = th.getAttribute('data-sort');
            const targetTable = th.getAttribute('data-table');
            
            if (targetTable === 'srv') {
                if (srvSort.key === prop) {
                    srvSort.dir = srvSort.dir === 'asc' ? 'desc' : 'asc';
                } else {
                    srvSort.key = prop;
                    srvSort.dir = 'asc';
                }
                const icon = th.querySelector('i');
                if (icon) {
                    document.querySelectorAll('th[data-table="srv"] i').forEach(i => i.className = 'fas fa-sort');
                    icon.className = srvSort.dir === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
                }
            } else if (targetTable === 'call') {
                if (callSort.key === prop) {
                    callSort.dir = callSort.dir === 'asc' ? 'desc' : 'asc';
                } else {
                    callSort.key = prop;
                    callSort.dir = 'asc';
                }
                const icon = th.querySelector('i');
                if (icon) {
                    document.querySelectorAll('th[data-table="call"] i').forEach(i => i.className = 'fas fa-sort');
                    icon.className = callSort.dir === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down';
                }
            }
            renderDashboard();
        });
    });

    // Load External Databases
    function loadAllDatabases() {
        // 1. Employee Data (Login)
        fetchJSONP(SHEETS.EMPLOYEES, 'parseEmployees', (data) => {
            let rawData = data.length > 0 ? data : getMockEmployeeData();
            
            // Normalize ALL rows immediately so isAdmin and other features are always accurate
            employeeData = rawData.map(row => {
                let normRow = { ...row };
                let foundAdmin = false;
                let foundAuth = false;
                let foundDept = false;
                let foundName = false;

                for (let [k, v] of Object.entries(normRow)) {
                    if (!k) continue;
                    const sk = k.trim().toLowerCase().replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/[^a-z0-z]/g, '');
                    const cleanKey = k.trim().toLowerCase().replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c');
                    
                    if (sk === 'admin' && v) {
                        normRow['isAdmin'] = v.toString().trim().toLowerCase() === 'evet';
                        foundAdmin = true;
                    }
                    if ((sk === 'sikayetyetkilisi' || sk === 'yetkili' || sk === 'sikayetyetkili') && v) {
                        const authVal = v.toString().trim().toLowerCase();
                        normRow['isAuthority'] = (authVal === 'evet' || authVal === 'yetkili');
                        foundAuth = true;
                    }
                    if (cleanKey === 'departman' && v) {
                        normRow['department'] = v.toString().trim();
                        foundDept = true;
                    }
                    if ((cleanKey === 'ad soyad' || cleanKey === 'name' || cleanKey === 'adsoyad') && v) {
                        normRow['Ad Soyad'] = v.toString().trim();
                        foundName = true;
                    }
                    if ((cleanKey === 'mail' || cleanKey === 'email' || cleanKey === 'e-posta' || cleanKey === 'eposta') && v) {
                        normRow['extMail'] = v.toString().trim();
                    }
                }
                
                if (!foundAdmin) normRow['isAdmin'] = false;
                if (!foundAuth) normRow['isAuthority'] = false;
                if (!foundDept) normRow['department'] = 'Bilinmiyor';
                
                return normRow;
            });

            console.log('Çalışanlar Yüklendi ve Parse Edildi:', employeeData.length);
        });

        // 2. Complaint Types (Call vs Service Dropdowns)
        fetchJSONP(SHEETS.COMPLAINT_TYPES, 'parseComplaintTypes', (data) => {
            complaintTypesData = data;
            console.log('Şikayet Türleri Yüklendi:', complaintTypesData.length);
        });

        // 3. Call Customers (Çağrı Şikayeti Müşteri Listesi)
        fetchJSONP(SHEETS.CALL_CUSTOMERS, 'parseCallCustomers', (data) => {
            callCustomersData = data;
            console.log('Çağrı Müşterileri Yüklendi:', callCustomersData.length);
        });

        // 4. Service Files (Hizmet Dosyaları - TS numaraları)
        fetchJSONP(SHEETS.SERVICE_FILES, 'parseServiceFiles', (data) => {
            serviceFilesData = data;
            console.log('Hizmet Dosyaları Yüklendi:', serviceFilesData.length);
        });

        // 5. Client Users (Dış Müşteri Kullanıcıları)
        fetchJSONP(SHEETS.CLIENT_USERS, 'parseClientUsers', (data) => {
            clientUsersData = data;
            
            // Eğer Google Sheets'ten sıfır veri dönerse (cache hatası vs.) kullanıcının son ilettiği verileri fallback olarak atıyoruz.
            if (!clientUsersData || clientUsersData.length === 0) {
                clientUsersData = [
                    { "Müşteri": "Unico Sigorta", "Kullanici": "unicosigorta", "Sifre": "123456", "Mail": "omerguclu42@gmail.com" },
                    { "Müşteri": "Eureko Sigorta", "Kullanici": "eurekosigorta", "Sifre": "123456", "Mail": "omerguclu42@gmail.com" },
                    { "Müşteri": "Quick Sigorta", "Kullanici": "quicksigorta", "Sifre": "123456", "Mail": "omerguclu42@gmail.com" },
                    { "Müşteri": "İnci Akü", "Kullanici": "inciakü", "Sifre": "123456", "Mail": "omerguclu42@gmail.com" },
                    { "Müşteri": "ADAC", "Kullanici": "adac", "Sifre": "123456", "Mail": "omerguclu42@gmail.com" },
                    { "Müşteri": "Ana Sigorta", "Kullanici": "anasigorta", "Sifre": "123456", "Mail": "omerguclu42@gmail.com" },
                    { "Müşteri": "Corpus Sigorta", "Kullanici": "corpussigorta", "Sifre": "123456", "Mail": "omerguclu42@gmail.com" },
                    { "Müşteri": "World Medicine", "Kullanici": "worldmedicine", "Sifre": "123456", "Mail": "omerguclu42@gmail.com" }
                ];
                console.log('Müşteri Kullanıcıları Yüklendi (Fallback Girdi):', clientUsersData.length);
            } else {
                console.log('Müşteri Kullanıcıları Yüklendi:', clientUsersData.length);
            }
        });
    }

    function getMockEmployeeData() {
        return [
            { 'AD SOYAD': 'Ömer Faruk Güçlü', 'Kullanici Adi': 'admin', 'Şifre': '123456', 'POZİSYON': 'Yönetici' }
        ];
    }

    // Initialize fetches
    loadAllDatabases();

    // View Navigation
    window.switchView = function(viewName) {
        Object.values(views).forEach(v => {
            if (v) {
                v.classList.remove('active');
                v.classList.add('hidden');
            }
        });
        if (views[viewName]) {
            views[viewName].classList.add('active');
            views[viewName].classList.remove('hidden');
        }
        
        // Setup Active Class for Nav Items
        document.querySelectorAll('.sidebar-nav li').forEach(li => li.classList.remove('active'));
        if (viewName === 'dashboard') {
            const nav = document.getElementById('nav-dashboard');
            const navOpt = document.getElementById('nav-dashboard-opt');
            const navOpt3 = document.getElementById('nav-dashboard-opt-3');
            if (nav) nav.classList.add('active');
            if (navOpt) navOpt.classList.add('active');
            if (navOpt3) navOpt3.classList.add('active');
        } else if (viewName === 'opinions') {
            const nav = document.getElementById('nav-opinions');
            const navOpt = document.getElementById('nav-opinions-opt');
            const navOpt3 = document.getElementById('nav-opinions-opt-3');
            if (nav) nav.classList.add('active');
            if (navOpt) navOpt.classList.add('active');
            if (navOpt3) navOpt3.classList.add('active');
        } else if (viewName === 'reports-internal' || viewName === 'reports-external' || viewName === 'reports') {
            
            // Fallback for legacy calls from mobile menu or client view
            if (viewName === 'reports') {
                viewName = (typeof globalUser !== 'undefined' && globalUser && globalUser.isClient) ? 'reports-external' : 'reports-internal';
            }

            const navIntNodes = document.querySelectorAll('#nav-reports-internal, #nav-reports-opt-internal, #nav-reports-opt-3-internal');
            const navExtNodes = document.querySelectorAll('#nav-reports-external, #nav-reports-opt-external, #nav-reports-opt-3-external');
            
            navIntNodes.forEach(el => el.classList.remove('active'));
            navExtNodes.forEach(el => el.classList.remove('active'));

            if (viewName === 'reports-internal') {
                navIntNodes.forEach(el => el.classList.add('active'));
                window.currentReportType = 'internal';
            } else {
                navExtNodes.forEach(el => el.classList.add('active'));
                window.currentReportType = 'external';
            }
            
            // Re-use the existing reports view DOM
            if (views['reports']) {
                views['reports'].classList.add('active');
                views['reports'].classList.remove('hidden');
            }
            
            const repTitle = document.getElementById('reports-main-title') || document.querySelector('#reports-view h1');
            if(repTitle) {
                repTitle.innerHTML = window.currentReportType === 'internal' 
                    ? '<i class="fas fa-chart-line"></i> İç Raporlar' 
                    : '<i class="fas fa-globe"></i> Dış Raporlar';
                repTitle.id = 'reports-main-title';
            }

            renderReports();
        }

        // Always restore visibility of items that might have been hidden by overlapping CSS or older logic
        if (typeof globalUser !== 'undefined' && globalUser) {
            const navRepIntNodes = document.querySelectorAll('#nav-reports-internal, #nav-reports-opt-internal, #nav-reports-opt-3-internal');
            const navRepExtNodes = document.querySelectorAll('#nav-reports-external, #nav-reports-opt-external, #nav-reports-opt-3-external');
            const navOpItems = document.querySelectorAll('#nav-opinions, #nav-opinions-opt, #nav-opinions-opt-3');
            
            if (globalUser.isClient) {
                navRepExtNodes.forEach(el => {
                    el.style.setProperty('display', 'block', 'important');
                    const link = el.querySelector('a');
                    if(link) link.innerHTML = '<i class="fas fa-chart-bar"></i> Raporlar';
                });
                navRepIntNodes.forEach(el => el.style.setProperty('display', 'none', 'important'));
                navOpItems.forEach(el => { if(el) el.style.setProperty('display', 'none', 'important'); });
            } else {
                if (globalUser.isAuthority) {
                    navRepIntNodes.forEach(el => el.style.setProperty('display', 'block', 'important'));
                    navRepExtNodes.forEach(el => {
                        el.style.setProperty('display', 'block', 'important');
                        const link = el.querySelector('a');
                        if(link) link.innerHTML = '<i class="fas fa-globe"></i> Dış Raporlar';
                    });
                } else {
                    navRepIntNodes.forEach(el => el.style.setProperty('display', 'none', 'important'));
                    navRepExtNodes.forEach(el => el.style.setProperty('display', 'none', 'important'));
                }
                
                if (globalUser.isAdmin) {
                    navOpItems.forEach(el => { if(el) el.style.setProperty('display', 'block', 'important'); });
                } else {
                    navOpItems.forEach(el => { if(el) el.style.setProperty('display', 'none', 'important'); });
                }
            }
        }
    };

    // Login Handle
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const user = usernameInput.value.trim();
        const pass = passwordInput.value.trim();

        globalUser = null;

        // Match user via CSV columns or Mock Data
        for (let row of employeeData) {
            // Trim keys and values to ensure no trailing spaces break the login
            let rowUser = "";
            let rowPass = "";
            let rowName = "";

            for (let key in row) {
                const cleanKey = key.trim().toLowerCase()
                    // normalize Turkish chars for comparison
                    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
                    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c');

                if (cleanKey === 'kullanici adi' || cleanKey === 'username' || cleanKey === 'kullaniciadı' || cleanKey === 'kullaniciadi') {
                    if (row[key] !== null && row[key] !== undefined) {
                        rowUser = row[key].toString().trim();
                    }
                }

                if (cleanKey === 'sifre' || cleanKey === 'password') {
                    if (row[key] !== null && row[key] !== undefined) {
                        rowPass = row[key].toString().trim();
                    }
                }

                if (cleanKey === 'ad soyad' || cleanKey === 'name' || cleanKey === 'adsoyad') {
                    if (row[key] !== null && row[key] !== undefined) {
                        rowName = row[key].toString().trim();
                    }
                }
                if (cleanKey === 'departman') {
                    if (row[key] !== null && row[key] !== undefined) {
                        row['department'] = row[key].toString().trim();
                    }
                }
                
                // Fallback for names in case they move
                const superCleanKey = key.trim().toLowerCase().replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/[^a-z0-z]/g, '');

                if (superCleanKey === 'admin') {
                    if (row[key] !== null && row[key] !== undefined) {
                        row['isAdmin'] = row[key].toString().trim().toLowerCase() === 'evet';
                    }
                }
                if (superCleanKey === 'sikayetyetkilisi' || superCleanKey === 'yetkili' || superCleanKey === 'sikayetyetkili') {
                    if (row[key] !== null && row[key] !== undefined) {
                        const val = row[key].toString().trim().toLowerCase();
                        row['isAuthority'] = (val === 'evet' || val === 'yetkili');
                    }
                }
            }

            // Absolute fallback overriding Google Sheets parsing shifting bugs
            let foundAdmin = false;
            let foundAuth = false;

            for (let [k, v] of Object.entries(row)) {
                if (!k) continue;
                const sk = k.trim().toLowerCase().replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/[^a-z0-z]/g, '');
                if (sk === 'admin' && v) {
                    row['isAdmin'] = v.toString().trim().toLowerCase() === 'evet';
                    foundAdmin = true;
                }
                if ((sk === 'sikayetyetkilisi' || sk === 'yetkili' || sk === 'sikayetyetkili') && v) {
                    const authVal = v.toString().trim().toLowerCase();
                    row['isAuthority'] = (authVal === 'evet' || authVal === 'yetkili');
                    foundAuth = true;
                }
            }

            // Fallback default
            if (!foundAdmin) row['isAdmin'] = false;
            if (!foundAuth) row['isAuthority'] = false;

            if (rowUser === user && rowPass === pass) {
                row["Ad Soyad"] = rowName; // normalize for later use
                row["isClient"] = false;
                if (row['isAdmin'] === undefined) row['isAdmin'] = false;
                if (row['isAuthority'] === undefined) row['isAuthority'] = false;
                if (!row['department']) row['department'] = 'Bilinmiyor';
                globalUser = row;
                break;
            }
        }

        // If not found in internal employees, check Clients
        if (!globalUser) {
            let activeClientData = (clientUsersData && clientUsersData.length > 0) ? clientUsersData : [
                { "Müşteri": "Unico Sigorta", "Kullanici": "unicosigorta", "Sifre": "123456", "Mail": "omerguclu42@gmail.com" },
                { "Müşteri": "Eureko Sigorta", "Kullanici": "eurekosigorta", "Sifre": "123456", "Mail": "omerguclu42@gmail.com" },
                { "Müşteri": "Quick Sigorta", "Kullanici": "quicksigorta", "Sifre": "123456", "Mail": "omerguclu42@gmail.com" },
                { "Müşteri": "İnci Akü", "Kullanici": "inciakü", "Sifre": "123456", "Mail": "omerguclu42@gmail.com" },
                { "Müşteri": "ADAC", "Kullanici": "adac", "Sifre": "123456", "Mail": "omerguclu42@gmail.com" },
                { "Müşteri": "Ana Sigorta", "Kullanici": "anasigorta", "Sifre": "123456", "Mail": "omerguclu42@gmail.com" },
                { "Müşteri": "Corpus Sigorta", "Kullanici": "corpussigorta", "Sifre": "123456", "Mail": "omerguclu42@gmail.com" },
                { "Müşteri": "World Medicine", "Kullanici": "worldmedicine", "Sifre": "123456", "Mail": "omerguclu42@gmail.com" }
            ];

            for (let row of activeClientData) {
                // Determine keys dynamically by cleaning headers
                let companyName = "", rowUser = "", rowPass = "";
                // Try mapping by name first
                for (let [k, expectedVal] of Object.entries(row)) {
                    if (!k) continue;
                    const cleanKey = k.trim().toLowerCase().replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/[^a-z0-z]/g, '');
                    if (cleanKey.includes('musteri') || cleanKey.includes('kurum') || cleanKey.includes('sirket')) {
                        companyName = expectedVal ? expectedVal.toString().trim() : '';
                    }
                    if (cleanKey === 'kullanici' || cleanKey === 'kullaniciadi' || cleanKey === 'username' || cleanKey === 'mail') {
                        if (expectedVal && !rowUser) rowUser = expectedVal.toString().trim();
                    }
                    if (cleanKey === 'sifre' || cleanKey === 'password') {
                        rowPass = expectedVal ? expectedVal.toString().trim() : '';
                    }
                }

                // If mapping fails due to GViz stripping headers, fallback to array index
                if (!rowUser || !rowPass) {
                    const vals = Object.values(row);
                    if (vals.length >= 3) {
                        companyName = vals[0] ? vals[0].toString().trim() : companyName;
                        rowUser = vals[1] ? vals[1].toString().trim() : rowUser;
                        rowPass = vals[2] ? vals[2].toString().trim() : rowPass;
                    }
                }

                if (rowUser === user && rowPass === pass) {
                    globalUser = {
                        "Ad Soyad": companyName + " Yetkilisi",
                        "Pozisyon": "Dış Müşteri",
                        "companyName": companyName,
                        "isClient": true,
                        "isAdmin": false,
                        "isAuthority": false,
                        "department": "Müşteri Portalı"
                    };
                    break;
                }
            }
        }

        // Hardcoded safety net for demo purposes (Admin Only Now)
        if (!globalUser && user === "admin" && pass === "123456") {
            globalUser = { "Ad Soyad": "Demo Yönetici", "Pozisyon": "Yönetici", "isClient": false, "isAdmin": true, "isAuthority": true, "department": "Yönetici Ekibi" };
        }

        if (globalUser) {
            loginError.classList.add('hidden');
            processLogin(globalUser);
        } else {
            loginError.classList.remove('hidden');
            // Flash shake effect for error
            loginForm.style.transform = "translateX(-5px)";
            setTimeout(() => loginForm.style.transform = "translateX(5px)", 100);
            setTimeout(() => loginForm.style.transform = "translateX(0)", 200);
        }
    });

    function processLogin(user) {
        console.log("=== LOGIN DEBUG ===");
        console.log("Logged in user:", user);
        console.log("Is Admin:", user.isAdmin);
        console.log("Is Authority:", user.isAuthority);
        console.log("===================");

        // 1. Show Loading Screen
        switchView('loading');

        let fullName = user["Ad Soyad"] || user["ad soyad"] || user["AD SOYAD"] || "Kullanıcı";
        let dept = user.department || user["Departman"] || user["departman"] || "Departman Bilinmiyor";
        let position = user["Pozisyon"] || user["pozisyon"] || user["POZİSYON"] || "Çalışan";
        let mail = user["Mail"] || user["mail"] || user["MAİL"] || user["Mail Bilgisi"] || "";

        // Populate Dashboard and Opinions View details
        document.querySelectorAll('#display-user-name, .display-user-name-clone').forEach(el => el.textContent = fullName);
        
        if (user.isClient) {
            document.querySelectorAll('#display-user-dept, .display-user-dept-clone, #display-user-role, .display-user-role-clone, #display-user-mail, .display-user-mail-clone').forEach(el => el.style.display = 'none');
        } else {
            document.querySelectorAll('#display-user-dept, .display-user-dept-clone').forEach(el => {
                el.innerHTML = `<i class="fas fa-building"></i> ${dept}`;
                el.style.display = 'block';
            });
            document.querySelectorAll('#display-user-role, .display-user-role-clone').forEach(el => {
                el.innerHTML = `<i class="fas fa-id-badge"></i> ${position}`;
                el.style.display = 'block';
            });
            document.querySelectorAll('#display-user-mail, .display-user-mail-clone').forEach(el => {
                el.innerHTML = `<i class="fas fa-envelope"></i> ${mail}`;
                el.style.display = 'flex';
            });
        }

        const dashWelcome = document.getElementById('dashboard-welcome-msg');
        if(dashWelcome) dashWelcome.textContent = "Hoş Geldin " + fullName;

        // Manage Role-Based Elements
        const onlyAdminEls = document.querySelectorAll('.only-admin');
        onlyAdminEls.forEach(el => {
            if (user.isAdmin) el.classList.remove('hidden');
            else el.classList.add('hidden');
        });

        const opinionsNavItems = document.querySelectorAll('#nav-opinions, #nav-opinions-opt, #nav-opinions-opt-3');
        if (user.isClient) {
            // Clients do not see the Opinions tab
            opinionsNavItems.forEach(el => {
                if(el) el.style.display = 'none';
            });
        } else {
            opinionsNavItems.forEach(el => {
                if(el) el.style.display = 'block';
            });
        }

        // Strictly Enforce "Görüş Bekleniyor" visibility
        const navOp1 = document.getElementById('nav-opinions');
        const navOp2 = document.getElementById('nav-opinions-opt');
        const navOp3 = document.getElementById('nav-opinions-opt-3');
        const canSeeOp = user.isAdmin; // Only Admins see Opinions. Clients and Normal Users do NOT.
        if (navOp1) { navOp1.style.display = canSeeOp ? 'block' : 'none'; }
        if (navOp2) { navOp2.style.display = canSeeOp ? 'block' : 'none'; }
        if (navOp3) { navOp3.style.display = canSeeOp ? 'block' : 'none'; }

        // Strictly Enforce "Raporlar" visibility
        const navRepInt = document.getElementById('nav-reports-internal');
        const navRepExt = document.getElementById('nav-reports-external');
        
        if (navRepInt) navRepInt.style.display = 'none';
        if (navRepExt) navRepExt.style.display = 'none';

        if (user.isClient) {
            // Client only sees their own external reports, but rename it to "Raporlar"
            if (navRepExt) {
                navRepExt.style.display = 'block';
                navRepExt.querySelector('a').innerHTML = '<i class="fas fa-chart-bar"></i> Raporlar';
            }
        } else {
            // General employees do NOT see any reports by default unless Authority
            if (user.isAuthority) {
                if (navRepInt) navRepInt.style.display = 'block';
                if (navRepExt) {
                    navRepExt.style.display = 'block';
                    navRepExt.querySelector('a').innerHTML = '<i class="fas fa-globe"></i> Dış Raporlar';
                }
            }
        }

        // Render Dashboard Data
        renderDashboard();

        // 2. Wait 3 Seconds
        setTimeout(() => {
            switchView('dashboard');

            // 3. Check and Show Welcome Modal
            const hideModal = localStorage.getItem('eurocross_hide_welcome');
            if (hideModal !== 'true') {
                setTimeout(() => {
                    welcomeModal.classList.remove('hidden');
                    setTimeout(() => welcomeModal.classList.add('show'), 10);
                }, 500);
            }
        }, 3000); // 3 seconds requirement
    }

    // Modal Handle
    if(welcomeOkBtn) {
        welcomeOkBtn.addEventListener('click', () => {
            if (dontShowAgainCheckbox && dontShowAgainCheckbox.checked) {
                localStorage.setItem('eurocross_hide_welcome', 'true');
            }
            if(welcomeModal) {
                welcomeModal.classList.remove('show');
                setTimeout(() => welcomeModal.classList.add('hidden'), 300);
            }
        });
    }

    // Logout
    document.querySelectorAll('#logout-btn, .logout-btn-clone').forEach(btn => {
        btn.addEventListener('click', () => {
            globalUser = null;
            if (usernameInput) usernameInput.value = '';
            if (passwordInput) passwordInput.value = '';
            switchView('login');
        });
    });

    // --- Notification Modal Logic ---
    const notifModal = document.getElementById('notification-modal');
    const notifTitle = document.getElementById('notification-title');
    const notifMessage = document.getElementById('notification-message');
    const notifIcon = document.getElementById('notification-icon');
    const closeNotifBtn = document.getElementById('close-notification-btn');

    function showNotification(title, message, type = 'success') {
        notifTitle.textContent = title;
        notifMessage.textContent = message;
        
        if (type === 'success') {
            notifIcon.innerHTML = '<i class="fas fa-check-circle"></i>';
            notifIcon.style.color = '#2ecc71';
        } else if (type === 'error') {
            notifIcon.innerHTML = '<i class="fas fa-exclamation-circle"></i>';
            notifIcon.style.color = '#e74c3c';
        } else if (type === 'warning') {
            notifIcon.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
            notifIcon.style.color = '#f39c12';
        }

        notifModal.classList.remove('hidden');
        void notifModal.offsetWidth;
        notifModal.classList.add('show');
    }

    closeNotifBtn.addEventListener('click', () => {
        notifModal.classList.remove('show');
        setTimeout(() => notifModal.classList.add('hidden'), 300);
    });

    // --- Custom Confirm Modal Logic ---
    const confirmModal = document.getElementById('confirm-modal');
    const confirmTitle = document.getElementById('confirm-title');
    const confirmMessage = document.getElementById('confirm-message');
    const confirmYesBtn = document.getElementById('confirm-yes-btn');
    const confirmNoBtn = document.getElementById('confirm-no-btn');

    function showConfirmDialog(message, title = 'Dikkat') {
        return new Promise((resolve) => {
            confirmTitle.textContent = title;
            // Provide line breaks support for confirm message
            confirmMessage.innerHTML = message.replace(/\n/g, '<br>');
            
            confirmModal.classList.remove('hidden');
            void confirmModal.offsetWidth;
            confirmModal.classList.add('show');

            const handleYes = () => {
                cleanup();
                resolve(true);
            };

            const handleNo = () => {
                cleanup();
                resolve(false);
            };

            const cleanup = () => {
                confirmYesBtn.removeEventListener('click', handleYes);
                confirmNoBtn.removeEventListener('click', handleNo);
                confirmModal.classList.remove('show');
                setTimeout(() => confirmModal.classList.add('hidden'), 300);
            };

            confirmYesBtn.addEventListener('click', handleYes);
            confirmNoBtn.addEventListener('click', handleNo);
        });
    }

    // Navigation Buttons / Modal Toggles
    const newComplaintBtn = document.getElementById('new-complaint-btn');
    const complaintModal = document.getElementById('complaint-modal');
    const closeComplaintBtn = document.getElementById('close-complaint-modal');

    newComplaintBtn.addEventListener('click', () => {
        initComplaintForm();
        complaintModal.classList.remove('hidden');
        void complaintModal.offsetWidth;
        complaintModal.classList.add('show');
    });

    if (closeComplaintBtn) {
        closeComplaintBtn.addEventListener('click', (e) => {
            e.preventDefault();
            complaintModal.classList.remove('show');
            setTimeout(() => complaintModal.classList.add('hidden'), 300);
        });
    }



    // --- Phone Masking Logic (0555) 555 55 55 ---
    function formatPhoneNumber(value) {
        if (!value) return value;
        const phoneNumber = value.replace(/[^\d]/g, '');
        const phoneNumberLength = phoneNumber.length;
        if (phoneNumberLength < 2) return phoneNumber;
        // Keep the leading zero if not typed
        let formattedStr = phoneNumber.startsWith('0') ? '' : '0';
        formattedStr += phoneNumber;
        
        const mLength = formattedStr.length;
        if (mLength < 5) return `(${formattedStr.slice(0, 4)}`;
        if (mLength < 8) return `(${formattedStr.slice(0, 4)}) ${formattedStr.slice(4, 7)}`;
        if (mLength < 10) return `(${formattedStr.slice(0, 4)}) ${formattedStr.slice(4, 7)} ${formattedStr.slice(7, 9)}`;
        return `(${formattedStr.slice(0, 4)}) ${formattedStr.slice(4, 7)} ${formattedStr.slice(7, 9)} ${formattedStr.slice(9, 11)}`;
    }

    function handlePhoneInput(e) {
        const formattedValue = formatPhoneNumber(e.target.value);
        e.target.value = formattedValue;
    }

    const srvPhoneInput = document.getElementById('srv-phone');
    const callPhoneInput = document.getElementById('call-phone');
    const clientPhoneInput = document.getElementById('client-phone');
    
    [srvPhoneInput, callPhoneInput, clientPhoneInput].forEach(inputEl => {
        if(inputEl) {
            inputEl.addEventListener('input', handlePhoneInput);
            inputEl.setAttribute('maxlength', '16'); // (0555) 555 55 55 is 16 chars max
        }
    });

    // --- Complaint Form Logic ---
    const compTypeSelect = document.getElementById('comp-type');
    const compReasonSelect = document.getElementById('comp-reason');
    const callSection = document.getElementById('call-complaint-section');
    const serviceSection = document.getElementById('service-complaint-section');
    const clientSection = document.getElementById('client-complaint-section');
    const saveComplaintBtn = document.getElementById('save-complaint-btn');

    function initComplaintForm() {
        // Reset form
        document.getElementById('create-complaint-form').reset();
        if (callSection) callSection.classList.add('hidden');
        if (serviceSection) serviceSection.classList.add('hidden');
        if (clientSection) clientSection.classList.add('hidden');
        compReasonSelect.disabled = true;
        saveComplaintBtn.disabled = true;
        
        // Populate "Şikayet Türü" dropdown
        if (complaintTypesData.length > 0) {
            const keys = Object.keys(complaintTypesData[0]);
            const typeKey = keys[0]; // Şikayet Türü is column A
            const types = [...new Set(complaintTypesData.map(item => item[typeKey]).filter(Boolean))];
            
            compTypeSelect.innerHTML = '<option value="">Seçiniz...</option>';
            types.forEach(type => {
                const opt = document.createElement('option');
                opt.value = type;
                opt.textContent = type;
                compTypeSelect.appendChild(opt);
            });
        }

        currentUploadedFiles = [];
        const fileListContainer = document.getElementById('attached-files-list');
        if (fileListContainer) fileListContainer.innerHTML = '';
        
        const displUser = document.getElementById('display-user-name');
        if (displUser && typeof globalUser !== 'undefined' && globalUser) {
            displUser.textContent = globalUser["Ad Soyad"] || "Kullanıcı";
        }
    }

    // Handle Type Selection -> Populate Reasons & Toggle UI
    compTypeSelect.addEventListener('change', (e) => {
        const selectedType = e.target.value;
        if (!selectedType) {
            compReasonSelect.innerHTML = '<option value="">Önce tür seçiniz...</option>';
            compReasonSelect.disabled = true;
            if (callSection) callSection.classList.add('hidden');
            if (serviceSection) serviceSection.classList.add('hidden');
            if (clientSection) clientSection.classList.add('hidden');
            saveComplaintBtn.disabled = true;
            return;
        }

        const keys = Object.keys(complaintTypesData[0]);
        const typeColumn = keys[0];
        const reasonColumn = keys[1];

        // Filter reasons based on type
        const reasons = complaintTypesData
            .filter(item => item[typeColumn] === selectedType)
            .map(item => item[reasonColumn])
            .filter(Boolean);

        compReasonSelect.innerHTML = '<option value="">Seçiniz...</option>';
        reasons.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r;
            opt.textContent = r;
            compReasonSelect.appendChild(opt);
        });
        compReasonSelect.disabled = false;

        // Toggle UI Sections based on selection
        const cleanedType = selectedType.trim();
        
        if (globalUser && globalUser.isClient) {
            if (callSection) callSection.classList.add('hidden');
            if (serviceSection) serviceSection.classList.add('hidden');
            if (clientSection) {
                clientSection.classList.remove('hidden');
                document.getElementById('client-customer').value = globalUser.companyName || "Müşteri";
                
                const clientIncidentDiv = document.getElementById('client-incident-date-wrapper');
                if (clientIncidentDiv) {
                    clientIncidentDiv.style.display = cleanedType === "Çağrı Şikayeti" ? 'block' : 'none';
                }
            }
        } else {
            if (clientSection) clientSection.classList.add('hidden');
            
            if (cleanedType === "Çağrı Şikayeti") {
                if (callSection) callSection.classList.remove('hidden');
                if (serviceSection) serviceSection.classList.add('hidden');
                populateCallCustomers();
            } else if (cleanedType === "Hizmet Şikayeti") {
                if (serviceSection) serviceSection.classList.remove('hidden');
                if (callSection) callSection.classList.add('hidden');
            } else {
                if (callSection) callSection.classList.add('hidden');
                if (serviceSection) serviceSection.classList.add('hidden');
            }
        }
    });

    // Populate Call Customers
    const callCustomerSelect = document.getElementById('call-customer');
    function populateCallCustomers() {
        if (callCustomersData.length > 0) {
            callCustomerSelect.innerHTML = '<option value="">Seçiniz...</option>';
            // Call customer sheet has values in first column
            const keys = Object.keys(callCustomersData[0]);
            callCustomersData.forEach(item => {
                const val = item[keys[0]];
                if(val) {
                    const opt = document.createElement('option');
                    opt.value = val;
                    opt.textContent = val;
                    callCustomerSelect.appendChild(opt);
                }
            });
        }
    }

    // Enable Save button if reason is selected
    compReasonSelect.addEventListener('change', (e) => {
        saveComplaintBtn.disabled = !e.target.value;
    });

    // --- Service Complaint TS Search Logic ---
    const srvSearchBtn = document.getElementById('service-search-btn');
    const srvSearchInput = document.getElementById('service-search-ts');
    const srvSearchStatus = document.getElementById('service-search-status');

    srvSearchBtn.addEventListener('click', () => {
        const query = srvSearchInput.value.trim().toUpperCase();
        if (!query) {
            srvSearchStatus.textContent = 'Lütfen bir dosya numarası girin.';
            srvSearchStatus.style.color = '#e74c3c';
            clearServiceForm();
            return;
        }

        srvSearchStatus.textContent = 'Aranıyor...';
        srvSearchStatus.style.color = 'var(--text-muted)';

        // Find match in serviceFilesData array
        // Expected property name is "ServiceId" which contains the TS... number
        const match = serviceFilesData.find(item => {
            const val = item['ServiceId'] || item['serviceid'] || '';
            return val.toUpperCase() === query;
        });

        if (match) {
            srvSearchStatus.innerHTML = '<i class="fas fa-check-circle"></i> Dosya bulundu.';
            srvSearchStatus.style.color = '#2ecc71';
            
            // Format Gviz Date string (Date(Y,M,D,H,m,s))
            let srvDateStr = match['ServiceCreatedDate'] || '';
            if (typeof srvDateStr === 'string' && srvDateStr.startsWith('Date(')) {
                const parts = srvDateStr.match(/\d+/g);
                if (parts && parts.length >= 3) {
                    const y = parts[0];
                    const m = String(parseInt(parts[1]) + 1).padStart(2, '0');
                    const d = parts[2].padStart(2, '0');
                    const h = parts[3] ? parts[3].padStart(2, '0') : '00';
                    const min = parts[4] ? parts[4].padStart(2, '0') : '00';
                    srvDateStr = `${d}.${m}.${y} ${h}:${min}`;
                }
            }
            
            // Populate fields
            document.getElementById('srv-case-no').value = match['CaseFileNo'] || '';
            document.getElementById('srv-date').value = srvDateStr;
            document.getElementById('srv-customer').value = match['InsuranceCompany'] || '';
            
            const fname = match['Insured Name'] || '';
            const lname = match['Insured Surname'] || '';
            document.getElementById('srv-name').value = `${fname} ${lname}`.trim();
            
            document.getElementById('srv-location').value = match['IncidentPlaceProvince'] || '';
            document.getElementById('srv-type').value = match['ProvidedService'] || '';
            document.getElementById('srv-provider').value = match['Provider'] || '';
        } else {
            srvSearchStatus.innerHTML = '<i class="fas fa-exclamation-circle"></i> Eşleşen dosya bulunamadı.';
            srvSearchStatus.style.color = '#e74c3c';
            clearServiceForm();
        }
    });

    // Reset readonly fields
    function clearServiceForm() {
        document.getElementById('srv-case-no').value = '';
        document.getElementById('srv-date').value = '';
        document.getElementById('srv-customer').value = '';
        document.getElementById('srv-name').value = '';
        document.getElementById('srv-location').value = '';
        document.getElementById('srv-type').value = '';
        document.getElementById('srv-provider').value = '';
    }

    // --- Save Complaint Logic ---
    const createForm = document.getElementById('create-complaint-form');
    let currentUploadedFiles = [];

    const fileInput = document.getElementById('complaint-doc');
    const fileListContainer = document.getElementById('attached-files-list');

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            currentUploadedFiles = [];
            fileListContainer.innerHTML = '';
            const files = e.target.files;
            
            Array.from(files).forEach(file => {
                const reader = new FileReader();
                reader.onload = function(event) {
                    currentUploadedFiles.push({
                        name: file.name,
                        type: file.type,
                        data: event.target.result // Base64
                    });
                    
                    const span = document.createElement('a');
                    span.href = event.target.result;
                    span.download = file.name;
                    span.className = 'status-badge status-open';
                    span.style.marginTop = '10px';
                    span.style.marginRight = '10px';
                    span.style.display = 'inline-block';
                    span.style.textDecoration = 'none';
                    span.innerHTML = `<i class="fas fa-download"></i> ${file.name}`;
                    fileListContainer.appendChild(span);
                };
                reader.readAsDataURL(file);
            });
        });
    }

    // Removed duplicate initComplaintForm function

    function generateComplaintId() {
        const year = new Date().getFullYear(); // e.g., 2026
        const prefix = `EC${year}`;
        
        // Find existing complaints for this year
        const yearComplaints = savedComplaints.filter(c => c.id && c.id.startsWith(prefix));
        
        let maxNum = 0;
        yearComplaints.forEach(c => {
            const numStr = c.id.replace(prefix, '');
            const num = parseInt(numStr, 10);
            if (!isNaN(num) && num > maxNum) {
                maxNum = num;
            }
        });
        
        maxNum += 1;
        // Pad with zeros to 7 digits
        const paddedNum = maxNum.toString().padStart(7, '0');
        return `${prefix}${paddedNum}`;
    }

    saveComplaintBtn.addEventListener('click', async (e) => {
        e.preventDefault();

        const type = compTypeSelect.value;
        const reason = compReasonSelect.value;
        
        const safeVal = (id) => {
            const el = document.getElementById(id);
            return el ? el.value : '';
        };

        // Validate Type and Reason
        if (!type || !reason) {
            alert('Lütfen Şikayet Türü ve Şikayet Sebebi alanlarını seçiniz.');
            return;
        }

        // Generate Date string
        const now = new Date();
        const dateStr = now.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + 
                        now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

        let newComplaint = {
            id: generateComplaintId(),
            type: type,
            reason: reason,
            status: 'Talep Açıldı',
            date: dateStr,
            author: globalUser ? (globalUser["Ad Soyad"] || globalUser["ad soyad"] || "Kullanıcı") : 'Sistem Görevlisi',
            department: globalUser ? globalUser.department : 'Bilinmiyor',
            logs: [{
                date: dateStr,
                action: 'Şikayet Oluşturuldu',
                user: globalUser ? (globalUser["Ad Soyad"] || globalUser["ad soyad"] || "Kullanıcı") : 'Sistem Görevlisi'
            }],
            files: currentUploadedFiles // Attach captured base64 files
        };

        const cleanedType = type.trim();

        if (globalUser && globalUser.isClient) {
            newComplaint.data = {
                customer: safeVal('client-customer'),
                name: safeVal('client-name'),
                phone: safeVal('client-phone'),
                policyNo: safeVal('client-policy-no'),
                incidentDate: safeVal('client-incident-date'),
                complaintText: safeVal('client-complaint-text'),
                opNote: safeVal('client-op-note')
            };

            // Client Validation Check
            if (!newComplaint.data.name || !newComplaint.data.phone || !newComplaint.data.policyNo || !newComplaint.data.complaintText || (cleanedType === "Çağrı Şikayeti" && !newComplaint.data.incidentDate)) {
                alert('Lütfen (*) ile işaretli tüm zorunlu alanları doldurunuz.');
                return;
            }

            // Client Policy Duplicate Check
            const duplicate = [...savedComplaints].reverse().find(c => {
                const existingPolicy = typeof c.data?.policyNo === 'string' ? c.data.policyNo.trim().toLowerCase() : '';
                const newPolicy = newComplaint.data.policyNo.trim().toLowerCase();
                return existingPolicy && existingPolicy === newPolicy;
            });

            if (duplicate) {
                const proceed = await showConfirmDialog(`${duplicate.date} tarihinde ${duplicate.data.policyNo} numaralı poliçe için bir şikayet kaydı açılmıştır.\n\nYine de devam etmek istiyor musunuz?`);
                if (!proceed) return;
            }

            newComplaint.data.isClient = true;

        } else {
            if (cleanedType === "Çağrı Şikayeti") {
                const phoneVal = safeVal('call-phone');
                if (phoneVal) {
                    const duplicate = [...savedComplaints].reverse().find(c => {
                        const cTypeClean = c.type ? String(c.type).trim() : '';
                        return cTypeClean === "Çağrı Şikayeti" && c.data && String(c.data.phone || '').trim() === phoneVal.trim();
                    });
                    
                    if (duplicate) {
                        const proceed = await showConfirmDialog(`${duplicate.date} tarihinde ${duplicate.data.phone || phoneVal} numaralı telefon için bir şikayet kaydı açılmıştır.\n\nYine de yeni bir şikayet kaydı açmak istiyor musunuz?`);
                        if (!proceed) return;
                    }
                }

                const incidentDateVal = safeVal('call-incident-date');
                if (!incidentDateVal) {
                    alert('Lütfen Şikayetin Yaşandığı Tarih ve Saat alanını doldurunuz.');
                    return;
                }

                newComplaint.data = {
                    customer: safeVal('call-customer'),
                    name: safeVal('call-name'),
                    phone: phoneVal,
                    incidentDate: incidentDateVal,
                    assistFile: safeVal('call-assist-file'),
                    damageFile: safeVal('call-damage-file'),
                    complaintText: safeVal('call-complaint-text'),
                    opNote: safeVal('call-op-note')
                };
            } else if (cleanedType === "Hizmet Şikayeti") {
                const tsVal = safeVal('service-search-ts');
                if (tsVal) {
                    const duplicate = [...savedComplaints].reverse().find(c => {
                        const cTypeClean = c.type ? String(c.type).trim() : '';
                        return cTypeClean === "Hizmet Şikayeti" && c.data && String(c.data.tsNumber || '').trim().toLowerCase() === tsVal.trim().toLowerCase();
                    });

                    if (duplicate) {
                        const proceed = await showConfirmDialog(`${duplicate.date} tarihinde ${duplicate.data.tsNumber || tsVal} dosya numaralı şikayet mevcuttur.\n\nYine de yeni bir şikayet kaydı açmak istiyor musunuz?`);
                        if (!proceed) return;
                    }
                }

                newComplaint.data = {
                    tsNumber: safeVal('service-search-ts'),
                    caseNo: safeVal('srv-case-no'),
                    caseDate: safeVal('srv-date'),
                    customer: safeVal('srv-customer'),
                    name: safeVal('srv-name'),
                    phone: safeVal('srv-phone'),
                    location: safeVal('srv-location'),
                    serviceType: safeVal('srv-type'),
                    provider: safeVal('srv-provider'),
                    complaintText: safeVal('srv-complaint-text'),
                    opNote: safeVal('srv-op-note')
                };
            }
        }

        // Save to Array and LocalStorage
        try {
            savedComplaints.push(newComplaint);
            saveComplaintsSafely();
        } catch (e) {
            console.error('Storage error:', e);
            savedComplaints.pop(); // Remove failed element
            showNotification('Kayıt Başarısız', 'Eklediğiniz evraklar çok büyük olduğu için hafıza doldu. Lütfen daha küçük evraklar seçin.', 'error');
            return; // Abort saving process
        }

        // Feedback and redirect
        showNotification('Kayıt Başarılı', 'Şikayet kaydı başarıyla oluşturuldu!\nStatü: Talep Açıldı', 'success');
        
        // (Email hook disabled per user request)

        // Close modal
        complaintModal.classList.remove('show');
        setTimeout(() => complaintModal.classList.add('hidden'), 300);
        
        renderDashboard();
    });

    // --- Render Dashboard Logic ---
    function renderDashboard() {
        const serviceTableBody = document.querySelector('#service-complaints-table tbody');
        const callTableBody = document.querySelector('#call-complaints-table tbody');
        const clientTableBody = document.querySelector('#client-complaints-table tbody');
        const opinionsTableBody = document.querySelector('#opinions-table tbody');
        
        if (serviceTableBody) serviceTableBody.innerHTML = '';
        if (callTableBody) callTableBody.innerHTML = '';
        if (clientTableBody) clientTableBody.innerHTML = '';
        if (opinionsTableBody) opinionsTableBody.innerHTML = '';

        // Handle Client Wrapper Visibility
        const clientWrapper = document.getElementById('client-complaints-wrapper');
        const srvWrapper = document.getElementById('service-complaints-wrapper');
        const callWrapper = document.getElementById('call-complaints-wrapper');
        const clientTableHeaders = document.querySelectorAll('.col-client-customer');

        if (globalUser && globalUser.isClient) {
            if (clientWrapper) clientWrapper.style.display = 'block';
            if (srvWrapper) srvWrapper.style.display = 'none';
            if (callWrapper) callWrapper.style.display = 'none';
            
            // Fallback to hide all table-sections with Çağrı Şikayetleri
            document.querySelectorAll('.table-section').forEach(el => {
                const headerText = el.querySelector('h3')?.textContent || '';
                if (headerText.includes('Çağrı Şikayetleri')) {
                    el.style.display = 'none';
                }
            });
            const filterClientCust = document.getElementById('filter-client-customer');
            if (filterClientCust) filterClientCust.style.display = 'none';
            
            clientTableHeaders.forEach(th => th.style.display = 'none');
        } else {
            if (srvWrapper) srvWrapper.style.display = 'block';
            if (callWrapper) callWrapper.style.display = 'block';

            // Dış Müşteri Şikayetleri ana sayfada sadece Yetkili olanlara gözükecek
            if (globalUser && globalUser.isAuthority) {
                if (clientWrapper) clientWrapper.style.display = 'block';
            } else {
                if (clientWrapper) clientWrapper.style.display = 'none';
            }

            document.querySelectorAll('.table-section').forEach(el => {
                const headerText = el.querySelector('h3')?.textContent || '';
                if (headerText.includes('Çağrı Şikayetleri')) {
                    el.style.display = 'block';
                }
            });
            const filterClientCust = document.getElementById('filter-client-customer');
            if (filterClientCust) filterClientCust.style.display = 'inline-block';
            
            clientTableHeaders.forEach(th => th.style.display = 'table-cell');
        }

        // Handle Sidebar Opinions Tab Visibility
        const opNavItems = document.querySelectorAll('#nav-opinions, #nav-opinions-opt, #nav-opinions-opt-3');
        if (globalUser && globalUser.isClient) {
            opNavItems.forEach(el => el.style.setProperty('display', 'none', 'important'));
        } else if (globalUser) {
            if (globalUser.isAdmin) {
                opNavItems.forEach(el => el.style.setProperty('display', 'block', 'important'));
            } else {
                opNavItems.forEach(el => el.style.setProperty('display', 'none', 'important'));
            }
        }

        // Force Reports Sidebar Nav Visibility
        const repIntNodes = document.querySelectorAll('#nav-reports-internal, #nav-reports-opt-internal, #nav-reports-opt-3-internal');
        const repExtNodes = document.querySelectorAll('#nav-reports-external, #nav-reports-opt-external, #nav-reports-opt-3-external');
        if (globalUser && globalUser.isClient) {
            repExtNodes.forEach(el => {
                el.style.setProperty('display', 'block', 'important');
                const lnk = el.querySelector('a');
                if(lnk) lnk.innerHTML = '<i class="fas fa-chart-bar"></i> Raporlar';
            });
            repIntNodes.forEach(el => el.style.setProperty('display', 'none', 'important'));
        } else if (globalUser) {
            if (globalUser.isAuthority) {
                repIntNodes.forEach(el => el.style.setProperty('display', 'block', 'important'));
                repExtNodes.forEach(el => {
                    el.style.setProperty('display', 'block', 'important');
                    const lnk = el.querySelector('a');
                    if(lnk) lnk.innerHTML = '<i class="fas fa-globe"></i> Dış Raporlar';
                });
            } else {
                repIntNodes.forEach(el => el.style.setProperty('display', 'none', 'important'));
                repExtNodes.forEach(el => el.style.setProperty('display', 'none', 'important'));
            }
        }

        // Status Counts & Sets
        let srvStats = { open: 0, process: 0, resolved: 0 };
        let callStats = { open: 0, process: 0, resolved: 0 };
        let clientStats = { open: 0, process: 0, resolved: 0 };

        // Dynamic Filtering Collections
        const uniqueSrvCustomers = new Set();
        const uniqueSrvTypes = new Set();
        const uniqueSrvProviders = new Set();
        const uniqueSrvDepts = new Set();
        const uniqueCallCustomers = new Set();
        const uniqueCallDepts = new Set();
        const uniqueSrvStatuses = new Set();
        const uniqueCallStatuses = new Set();
        const uniqueClientStatuses = new Set();
        const uniqueClientCustomers = new Set();

        // 1st Pass: Gather dynamic filter data + Stats
        savedComplaints.forEach(c => {
            // Role Isolation for Stats Output
            if (globalUser) {
                const userDept = globalUser.department || 'Bilinmiyor';
                const isAuth = globalUser.isAuthority === true;
                const cDept = c.department || 'Bilinmiyor';
                if (!isAuth && cDept !== userDept) return; // Do not count other department's complaints
            }

            const cTypeClean = c.type ? c.type.trim() : '';

            let stGroup = 'process';
            if (c.status === 'Talep Açıldı') stGroup = 'open';
            else if (c.status === 'Dosya Sonuçlandı' || c.status === 'Şikayet Sonuçlandı') stGroup = 'resolved';

            // Check if it's a Client Complaint
            if (c.source === 'client' || (c.data && c.data.policyNo)) {
                if (globalUser && globalUser.isClient) {
                    if (String(c.data.customer || '').trim() !== String(globalUser.companyName || '').trim()) return;
                }
                clientStats[stGroup]++;
                if (c.status) uniqueClientStatuses.add(c.status);
                if (c.data && c.data.customer) uniqueClientCustomers.add(String(c.data.customer).trim());
            } else {
                // Internal Stats
                if (cTypeClean === "Hizmet Şikayeti") {
                    srvStats[stGroup]++;
                    if (c.status) uniqueSrvStatuses.add(c.status);
                    if (c.department) uniqueSrvDepts.add(String(c.department).trim());
                    if (c.data && c.data.customer) uniqueSrvCustomers.add(String(c.data.customer).trim());
                    if (c.data && c.data.serviceType) uniqueSrvTypes.add(String(c.data.serviceType).trim());
                    if (c.data && c.data.provider) uniqueSrvProviders.add(String(c.data.provider).trim());
                } else if (cTypeClean === "Çağrı Şikayeti") {
                    callStats[stGroup]++;
                    if (c.status) uniqueCallStatuses.add(c.status);
                    if (c.department) uniqueCallDepts.add(String(c.department).trim());
                    if (c.data && c.data.customer) uniqueCallCustomers.add(c.data.customer.trim());
                }
            }
        });

        // Populate Selectors Options
        const populateSelect = (elementId, dataSet, defaultValue) => {
            const el = document.getElementById(elementId);
            if(!el) return;
            const currentVal = el.value;
            el.innerHTML = `<option value="">${defaultValue}</option>`;
            [...dataSet].sort().forEach(item => {
                const opt = document.createElement('option');
                opt.value = item;
                opt.textContent = item;
                if(item === currentVal) opt.selected = true;
                el.appendChild(opt);
            });
        };

        populateSelect('filter-srv-customer', uniqueSrvCustomers, 'Tüm Müşteriler');
        populateSelect('filter-srv-type', uniqueSrvTypes, 'Tüm Hizmet Türleri');
        populateSelect('filter-srv-provider', uniqueSrvProviders, 'Tüm Tedarikçiler');
        populateSelect('filter-srv-status', uniqueSrvStatuses, 'Tüm Statüler');
        populateSelect('filter-srv-dept', uniqueSrvDepts, 'Tüm Departmanlar');
        
        populateSelect('filter-call-customer', uniqueCallCustomers, 'Tüm Müşteriler');
        populateSelect('filter-call-status', uniqueCallStatuses, 'Tüm Statüler');
        populateSelect('filter-call-dept', uniqueCallDepts, 'Tüm Departmanlar');
        
        populateSelect('filter-client-status', uniqueClientStatuses, 'Tüm Statüler');
        populateSelect('filter-client-customer', uniqueClientCustomers, 'Tüm Müşteriler');

        // Filters - Service
        const fSrvId = (document.getElementById('filter-srv-id')?.value || '').toLowerCase();
        const fSrvYear = document.getElementById('filter-srv-year')?.value || '';
        const fSrvMonth = document.getElementById('filter-srv-month')?.value || '';
        const fSrvStatus = document.getElementById('filter-srv-status')?.value || '';
        const fSrvTs = (document.getElementById('filter-srv-ts')?.value || '').toLowerCase();
        const fSrvCust = (document.getElementById('filter-srv-customer')?.value || '').toLowerCase();
        const fSrvName = (document.getElementById('filter-srv-name')?.value || '').toLowerCase();
        const fSrvType = (document.getElementById('filter-srv-type')?.value || '').toLowerCase();
        const fSrvProv = (document.getElementById('filter-srv-provider')?.value || '').toLowerCase();
        const fSrvDept = document.getElementById('filter-srv-dept')?.value || '';

        // Filters - Call
        const fCallId = (document.getElementById('filter-call-id')?.value || '').toLowerCase();
        const fCallYear = document.getElementById('filter-call-year')?.value || '';
        const fCallMonth = document.getElementById('filter-call-month')?.value || '';
        const fCallStatus = document.getElementById('filter-call-status')?.value || '';
        const fCallCust = (document.getElementById('filter-call-customer')?.value || '').toLowerCase();
        const fCallName = (document.getElementById('filter-call-name')?.value || '').toLowerCase();
        const fCallPhone = (document.getElementById('filter-call-phone')?.value || '').toLowerCase();
        const fCallDept = document.getElementById('filter-call-dept')?.value || '';

        // Filters - Client
        const fClientId = (document.getElementById('filter-client-id')?.value || '').toLowerCase();
        const fClientStatus = document.getElementById('filter-client-status')?.value || '';
        const fClientYear = document.getElementById('filter-client-year')?.value || '';
        const fClientMonth = document.getElementById('filter-client-month')?.value || '';
        const fClientName = (document.getElementById('filter-client-name')?.value || '').toLowerCase();
        const fClientPolicy = (document.getElementById('filter-client-policy')?.value || '').toLowerCase();
        const fClientCust = (document.getElementById('filter-client-customer')?.value || '').toLowerCase();
        const fClientPhone = (document.getElementById('filter-client-phone')?.value || '').toLowerCase();

        // 2nd Pass: Filter, Sort, Paginate
        let srvRows = [];
        let callRows = [];
        let clientRows = [];
        let opSrvRows = [];
        let opCallRows = [];
        let opClientRows = [];
        let opDoneSrvRows = [];
        let opDoneCallRows = [];
        let opDoneClientRows = [];

        [...savedComplaints].forEach(c => { // Do not reverse initially, sort handles it
            // Role Isolation
            if (globalUser) {
                if (globalUser.isClient) {
                    if (String(c.data?.customer || '').trim() !== String(globalUser.companyName || '').trim()) return;
                } else {
                    const userDept = globalUser.department || 'Bilinmiyor';
                    const isAuth = globalUser.isAuthority === true;
                    const cDept = c.department || 'Bilinmiyor';
                    if (!isAuth && cDept !== userDept) return;
                }
            }

            let cDateParts = String(c.date || '').split(' ')[0].split('.'); 
            let cMonth = cDateParts[1] || '';
            let cYear = cDateParts[2] || '';
            const cTypeClean = c.type ? String(c.type).trim() : '';

            // Format Gviz Date string (Date(Y,M,D,H,m,s)) for legacy records
            let displayCaseDate = c.data?.caseDate || '-';
            if (typeof displayCaseDate === 'string' && displayCaseDate.startsWith('Date(')) {
                const parts = displayCaseDate.match(/\d+/g);
                if (parts && parts.length >= 3) {
                    const y = parts[0];
                    const m = String(parseInt(parts[1]) + 1).padStart(2, '0');
                    const d = parts[2].padStart(2, '0');
                    const h = parts[3] ? parts[3].padStart(2, '0') : '00';
                    const min = parts[4] ? parts[4].padStart(2, '0') : '00';
                    displayCaseDate = `${d}.${m}.${y} ${h}:${min}`;
                }
            }
            c._displayCaseDate = displayCaseDate; // Cache it for sorting logic and UI

            if (c.data && c.data.policyNo) {
                // Client specific isolation
                if (globalUser && globalUser.isClient && String(c.data.customer || '').trim() !== String(globalUser.companyName || '').trim()) return;
                
                if (fClientId && !String(c.id || '').toLowerCase().includes(fClientId)) return;
                if (fClientStatus && c.status !== fClientStatus) return;
                if (fClientYear && cYear !== fClientYear) return;
                if (fClientMonth && cMonth !== fClientMonth) return;
                if (fClientName && !String(c.data?.name || '').toLowerCase().includes(fClientName)) return;
                if (fClientPolicy && !String(c.data?.policyNo || '').toLowerCase().includes(fClientPolicy)) return;
                if (fClientCust && String(c.data?.customer || '').toLowerCase() !== fClientCust) return;
                if (fClientPhone && !String(c.data?.phone || '').toLowerCase().includes(fClientPhone)) return;
                clientRows.push(c);
            } else if (cTypeClean === "Hizmet Şikayeti") {
                if (fSrvId && !String(c.id || '').toLowerCase().includes(fSrvId)) return;
                if (fSrvYear && cYear !== fSrvYear) return;
                if (fSrvMonth && cMonth !== fSrvMonth) return;
                if (fSrvStatus && c.status !== fSrvStatus) return;
                if (fSrvTs && !String(c.data?.tsNumber || '').toLowerCase().includes(fSrvTs)) return;
                if (fSrvCust && c.data?.customer !== fSrvCust) return;
                if (fSrvName && !String(c.data?.name || '').toLowerCase().includes(fSrvName)) return;
                if (fSrvType && c.data?.serviceType !== fSrvType) return;
                if (fSrvProv && c.data?.provider !== fSrvProv) return;
                if (fSrvDept && String(c.department || '').trim() !== fSrvDept) return;
                srvRows.push(c);
            } else {
                if (fCallId && !String(c.id || '').toLowerCase().includes(fCallId)) return;
                if (fCallYear && cYear !== fCallYear) return;
                if (fCallMonth && cMonth !== fCallMonth) return;
                if (fCallStatus && c.status !== fCallStatus) return;
                if (fCallCust && c.data?.customer !== fCallCust) return;
                if (fCallName && !String(c.data?.name || '').toLowerCase().includes(fCallName)) return;
                if (fCallPhone && !String(c.data?.phone || '').toLowerCase().includes(fCallPhone)) return;
                if (fCallDept && String(c.department || '').trim() !== fCallDept) return;
                callRows.push(c);
            }
        });

        // Sorting Logic
        const sortArray = (arr, sortConfig) => {
            if(!sortConfig.key) return arr.reverse();
            arr.sort((a, b) => {
                let valA = '', valB = '';
                switch(sortConfig.key) {
                    case 'id': valA = String(a.id); valB = String(b.id); break;
                    case 'status': valA = a.status; valB = b.status; break;
                    case 'department': valA = a.department; valB = b.department; break;
                    case 'date': 
                        valA = a.date.split(' ').map(p => p.includes('.') ? p.split('.').reverse().join('') : p).join(''); 
                        valB = b.date.split(' ').map(p => p.includes('.') ? p.split('.').reverse().join('') : p).join('');
                        break;
                    case 'tsNumber': valA = a.data?.tsNumber || ''; valB = b.data?.tsNumber || ''; break;
                    case 'caseDate': 
                        valA = a._displayCaseDate.split(' ').map(p => p.includes('.') ? p.split('.').reverse().join('') : p).join(''); 
                        valB = b._displayCaseDate.split(' ').map(p => p.includes('.') ? p.split('.').reverse().join('') : p).join(''); 
                        break;
                    case 'customer': valA = a.data?.customer || ''; valB = b.data?.customer || ''; break;
                    case 'name': valA = a.data?.name || ''; valB = b.data?.name || ''; break;
                    case 'phone': valA = a.data?.phone || ''; valB = b.data?.phone || ''; break;
                    case 'policyNo': valA = a.data?.policyNo || ''; valB = b.data?.policyNo || ''; break;
                    case 'serviceType': valA = a.data?.serviceType || ''; valB = b.data?.serviceType || ''; break;
                    case 'provider': valA = a.data?.provider || ''; valB = b.data?.provider || ''; break;
                }
                
                if (valA === valB) return 0;
                let compareResult = String(valA).localeCompare(String(valB), undefined, {numeric: true, sensitivity: 'base'});
                return sortConfig.dir === 'asc' ? compareResult : -compareResult;
            });
            return arr;
        };

        sortArray(srvRows, srvSort);
        sortArray(callRows, callSort);
        sortArray(clientRows, clientSort);

        // Pagination setup
        const renderPagination = (totalItems, currentPage, elementId, type) => {
            const container = document.getElementById(elementId);
            if (!container) return;
            container.innerHTML = '';
            
            const totalPages = Math.ceil(totalItems / PAGE_SIZE) || 1;
            
            // Adjust current page just in case filtering shortened the list too much
            if (currentPage > totalPages) {
                if (type === 'srv') srvPage = totalPages;
                else if (type === 'call') callPage = totalPages;
                else if (type === 'client') clientPage = totalPages;
                else if (type === 'opSrv') opSrvPage = totalPages;
                else if (type === 'opCall') opCallPage = totalPages;
                else if (type === 'opClient') opClientPage = totalPages;
                else if (type === 'opDoneSrv') opDoneSrvPage = totalPages;
                else if (type === 'opDoneCall') opDoneCallPage = totalPages;
                else if (type === 'opDoneClient') opDoneClientPage = totalPages;
                currentPage = totalPages;
            }

            for (let i = 1; i <= totalPages; i++) {
                const btn = document.createElement('button');
                btn.className = `pagination-btn ${i === currentPage ? 'active' : ''}`;
                btn.textContent = i;
                btn.onclick = () => {
                    if (type === 'srv') srvPage = i;
                    else if (type === 'call') callPage = i;
                    else if (type === 'client') clientPage = i;
                    else if (type === 'opSrv') opSrvPage = i;
                    else if (type === 'opCall') opCallPage = i;
                    else if (type === 'opClient') opClientPage = i;
                    else if (type === 'opDoneSrv') opDoneSrvPage = i;
                    else if (type === 'opDoneCall') opDoneCallPage = i;
                    else if (type === 'opDoneClient') opDoneClientPage = i;
                    renderDashboard();
                };
                container.appendChild(btn);
            }
        };

        renderPagination(srvRows.length, srvPage, 'srv-pagination', 'srv');
        renderPagination(callRows.length, callPage, 'call-pagination', 'call');
        renderPagination(clientRows.length, clientPage, 'client-pagination', 'client');

        const paginatedSrv = srvRows.slice((srvPage - 1) * PAGE_SIZE, srvPage * PAGE_SIZE);
        const paginatedCall = callRows.slice((callPage - 1) * PAGE_SIZE, callPage * PAGE_SIZE);
        const paginatedClient = clientRows.slice((clientPage - 1) * PAGE_SIZE, clientPage * PAGE_SIZE);

        const getStatusBadgeClass = (status) => {
            if(status === 'Talep Açıldı') return 'status-open';
            if(status === 'Dosya Sonuçlandı' || status === 'Şikayet Sonuçlandı') return 'status-resolved';
            return 'status-process';
        };

        paginatedSrv.forEach(c => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${c.id || '-'}</strong></td>
                <td><span class="status-badge ${getStatusBadgeClass(c.status)}">${c.status}</span></td>
                <td>${c.department || 'Bilinmiyor'}</td>
                <td>${c.date}</td>
                <td>${c.data?.tsNumber || '-'}</td>
                <td>${c.data?.customer || '-'}</td>
                <td>${c.data?.name || '-'}</td>
                <td>${c.data?.phone || '-'}</td>
                <td>${c.data?.serviceType || '-'}</td>
                <td>${c.data?.provider || '-'}</td>
                <td>
                    <button class="btn-secondary" style="padding: 6px 12px; font-size: 0.8rem;" onclick="viewComplaintDetails('${c.id}')">
                        <i class="fas fa-eye"></i> İncele
                    </button>
                </td>
            `;
            serviceTableBody.appendChild(tr);
        });

        paginatedCall.forEach(c => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${c.id || '-'}</strong></td>
                <td><span class="status-badge ${getStatusBadgeClass(c.status)}">${c.status}</span></td>
                <td>${c.department || 'Bilinmiyor'}</td>
                <td>${c.date}</td>
                <td>${c.data?.customer || '-'}</td>
                <td>${c.data?.name || '-'}</td>
                <td>${c.data?.phone || '-'}</td>
                <td>
                    <button class="btn-secondary" style="padding: 6px 12px; font-size: 0.8rem;" onclick="viewComplaintDetails('${c.id}')">
                        <i class="fas fa-eye"></i> İncele
                    </button>
                </td>
            `;
            callTableBody.appendChild(tr);
        });

        paginatedClient.forEach(c => {
            const tr = document.createElement('tr');
            let custCol = ``;
            if (globalUser && !globalUser.isClient) {
                custCol = `<td>${c.data?.customer || '-'}</td>`;
            } else {
                custCol = `<td style="display:none;">${c.data?.customer || '-'}</td>`;
            }

            tr.innerHTML = `
                <td><strong>${c.id || '-'}</strong></td>
                <td><span class="status-badge ${getStatusBadgeClass(c.status)}">${c.status}</span></td>
                <td>${c.date}</td>
                ${custCol}
                <td>${c.data?.policyNo || '-'}</td>
                <td>${c.data?.name || '-'}</td>
                <td>${c.data?.phone || '-'}</td>
                <td>
                    <button class="btn-secondary" style="padding: 6px 12px; font-size: 0.8rem;" onclick="viewComplaintDetails('${c.id}')">
                        <i class="fas fa-eye"></i> İncele
                    </button>
                </td>
            `;
            if (clientTableBody) clientTableBody.appendChild(tr);
        });

        // Ensure tables don't look completely empty if filtered to 0
        if (clientTableBody && paginatedClient.length === 0) {
            clientTableBody.innerHTML = `<tr><td colspan="7" class="table-empty">Eşleşen Müşteri Şikayeti bulunamadı.</td></tr>`;
        }
        if (serviceTableBody && paginatedSrv.length === 0) {
            serviceTableBody.innerHTML = `<tr><td colspan="11" class="table-empty">Eşleşen Hizmet Şikayeti bulunamadı.</td></tr>`;
        }
        if (callTableBody.children.length === 0) {
            callTableBody.innerHTML = `<tr><td colspan="7" class="table-empty">Eşleşen Çağrı Şikayeti bulunamadı.</td></tr>`;
        }

        // Update Stat Cards (only if they exist on the DOM)
        // Update Stat Cards (only if they exist on the DOM)
        const callStatOpen = document.getElementById('call-stat-open');
        if(callStatOpen) {
            document.getElementById('srv-stat-open').textContent = srvStats.open;
            document.getElementById('srv-stat-process').textContent = srvStats.process;
            document.getElementById('srv-stat-resolved').textContent = srvStats.resolved;
            
            document.getElementById('call-stat-open').textContent = callStats.open;
            document.getElementById('call-stat-process').textContent = callStats.process;
            document.getElementById('call-stat-resolved').textContent = callStats.resolved;
        }

        const clientStatOpen = document.getElementById('client-stat-open');
        if(clientStatOpen) {
            document.getElementById('client-stat-open').textContent = clientStats.open;
            document.getElementById('client-stat-process').textContent = clientStats.process;
            document.getElementById('client-stat-resolved').textContent = clientStats.resolved;
        }

        // Populate Selectors Options
        populateSelect('filter-srv-customer', uniqueSrvCustomers, 'Tüm Müşteriler');
        populateSelect('filter-srv-type', uniqueSrvTypes, 'Tüm Hizmet Türleri');
        populateSelect('filter-srv-provider', uniqueSrvProviders, 'Tüm Tedarikçiler');
        populateSelect('filter-call-customer', uniqueCallCustomers, 'Tüm Müşteriler');

        // Opinions View Selectors
        populateSelect('filter-op-srv-customer', uniqueSrvCustomers, 'Tüm Müşteriler');
        populateSelect('filter-op-srv-type', uniqueSrvTypes, 'Tüm Hizmet Türleri');
        populateSelect('filter-op-call-customer', uniqueCallCustomers, 'Tüm Müşteriler');

        // Render Pending Opinions Tables (if Admin)
        const srvOpinionsBody = document.getElementById('opinions-service-tbody');
        const callOpinionsBody = document.getElementById('opinions-call-tbody');
        const clientOpinionsBody = document.getElementById('opinions-client-tbody');
        const srvOpinionsDoneBody = document.getElementById('opinions-done-service-tbody');
        const callOpinionsDoneBody = document.getElementById('opinions-done-call-tbody');
        const clientOpinionsDoneBody = document.getElementById('opinions-done-client-tbody');
        
        if (globalUser && globalUser.isAdmin === true && srvOpinionsBody && callOpinionsBody) {
            srvOpinionsBody.innerHTML = '';
            callOpinionsBody.innerHTML = '';
            if (clientOpinionsBody) clientOpinionsBody.innerHTML = '';
            if (srvOpinionsDoneBody) srvOpinionsDoneBody.innerHTML = '';
            if (callOpinionsDoneBody) callOpinionsDoneBody.innerHTML = '';
            if (clientOpinionsDoneBody) clientOpinionsDoneBody.innerHTML = '';
            
            let pendingOpinionsCount = 0;
            const myDept = globalUser.department;
            const myName = globalUser["Ad Soyad"];

            // Arrays are declared globally above
            // Filters - Opinions Bekleyen
            const fOpSrvTs = (document.getElementById('filter-op-srv-ts')?.value || '').toLowerCase();
            const fOpSrvName = (document.getElementById('filter-op-srv-name')?.value || '').toLowerCase();
            const fOpSrvCust = (document.getElementById('filter-op-srv-customer')?.value || '').toLowerCase();
            const fOpSrvType = (document.getElementById('filter-op-srv-type')?.value || '').toLowerCase();

            const fOpCallName = (document.getElementById('filter-op-call-name')?.value || '').toLowerCase();
            const fOpCallPhone = (document.getElementById('filter-op-call-phone')?.value || '').toLowerCase();
            const fOpCallCust = (document.getElementById('filter-op-call-customer')?.value || '').toLowerCase();

            const fOpClientName = (document.getElementById('filter-op-client-name')?.value || '').toLowerCase();
            const fOpClientPolicy = (document.getElementById('filter-op-client-policy')?.value || '').toLowerCase();
            const fOpClientCust = (document.getElementById('filter-op-client-customer')?.value || '').toLowerCase();

            // Filters - Opinions Tamamlanan
            const fOpDoneSrvTs = (document.getElementById('filter-op-done-srv-ts')?.value || '').toLowerCase();
            const fOpDoneSrvName = (document.getElementById('filter-op-done-srv-name')?.value || '').toLowerCase();
            const fOpDoneCallName = (document.getElementById('filter-op-done-call-name')?.value || '').toLowerCase();
            const fOpDoneClientName = (document.getElementById('filter-op-done-client-name')?.value || '').toLowerCase();

            [...savedComplaints].forEach(c => {
                const cTypeClean = c.type ? String(c.type).trim() : '';
                if (!c.data || !Array.isArray(c.data.opinionRequests)) return;

                const isPendingForMe = c.data.opinionRequests.some(req => {
                    if (req.status === 'Bekleniyor' && req.targetDept === myDept) {
                        return (!req.targetAdmins || req.targetAdmins.length === 0 || req.targetAdmins.includes(myName));
                    }
                    return false;
                });
                
                const isDoneByMe = c.data.opinionRequests.some(req => {
                    if ((req.status === 'Cevaplandı' || req.status === 'Görüş Verildi') && req.targetDept === myDept) {
                        return (!req.targetAdmins || req.targetAdmins.length === 0 || req.targetAdmins.includes(myName));
                    }
                    return false;
                });

                if (isPendingForMe) {
                    pendingOpinionsCount++;
                    if (c.data && c.data.policyNo) {
                        if (fOpClientName && !String(c.data?.name || '').toLowerCase().includes(fOpClientName)) return;
                        if (fOpClientPolicy && !String(c.data?.policyNo || '').toLowerCase().includes(fOpClientPolicy)) return;
                        if (fOpClientCust && String(c.data?.customer || '').toLowerCase() !== fOpClientCust) return;
                        opClientRows.push(c);
                    } else if (cTypeClean === "Hizmet Şikayeti" || cTypeClean === 'İç Müşteri Hizmet Şikayeti') {
                        if (fOpSrvTs && !String(c.data?.tsNumber || '').toLowerCase().includes(fOpSrvTs)) return;
                        if (fOpSrvName && !String(c.data?.name || '').toLowerCase().includes(fOpSrvName)) return;
                        if (fOpSrvCust && String(c.data?.customer || '').toLowerCase() !== fOpSrvCust) return;
                        if (fOpSrvType && String(c.data?.serviceType || '').toLowerCase() !== fOpSrvType) return;
                        opSrvRows.push(c);
                    } else {
                        if (fOpCallName && !String(c.data?.name || '').toLowerCase().includes(fOpCallName)) return;
                        if (fOpCallPhone && !String(c.data?.phone || '').toLowerCase().includes(fOpCallPhone)) return;
                        if (fOpCallCust && String(c.data?.customer || '').toLowerCase() !== fOpCallCust) return;
                        opCallRows.push(c);
                    }
                } else if (isDoneByMe) {
                    if (c.data && c.data.policyNo) {
                        if (fOpDoneClientName && !String(c.data?.name || '').toLowerCase().includes(fOpDoneClientName)) return;
                        opDoneClientRows.push(c);
                    } else if (cTypeClean === "Hizmet Şikayeti" || cTypeClean === 'İç Müşteri Hizmet Şikayeti') {
                        if (fOpDoneSrvTs && !String(c.data?.tsNumber || '').toLowerCase().includes(fOpDoneSrvTs)) return;
                        if (fOpDoneSrvName && !String(c.data?.name || '').toLowerCase().includes(fOpDoneSrvName)) return;
                        opDoneSrvRows.push(c);
                    } else {
                        if (fOpDoneCallName && !String(c.data?.name || '').toLowerCase().includes(fOpDoneCallName)) return;
                        opDoneCallRows.push(c);
                    }
                }
            });

            // Sorting
            sortArray(opSrvRows, opSrvSort);
            sortArray(opCallRows, opCallSort);
            sortArray(opClientRows, opClientSort);
            sortArray(opDoneSrvRows, opDoneSrvSort);
            sortArray(opDoneCallRows, opDoneCallSort);
            sortArray(opDoneClientRows, opDoneClientSort);

            // Pagination Render
            renderPagination(opSrvRows.length, opSrvPage, 'op-srv-pagination', 'opSrv');
            renderPagination(opCallRows.length, opCallPage, 'op-call-pagination', 'opCall');
            renderPagination(opClientRows.length, opClientPage, 'op-client-pagination', 'opClient');
            renderPagination(opDoneSrvRows.length, opDoneSrvPage, 'op-done-srv-pagination', 'opDoneSrv');
            renderPagination(opDoneCallRows.length, opDoneCallPage, 'op-done-call-pagination', 'opDoneCall');
            renderPagination(opDoneClientRows.length, opDoneClientPage, 'op-done-client-pagination', 'opDoneClient');

            // Data Slicing
            const pagOpSrv = opSrvRows.slice((opSrvPage - 1) * PAGE_SIZE, opSrvPage * PAGE_SIZE);
            const pagOpCall = opCallRows.slice((opCallPage - 1) * PAGE_SIZE, opCallPage * PAGE_SIZE);
            const pagOpClient = opClientRows.slice((opClientPage - 1) * PAGE_SIZE, opClientPage * PAGE_SIZE);
            const pagOpDoneSrv = opDoneSrvRows.slice((opDoneSrvPage - 1) * PAGE_SIZE, opDoneSrvPage * PAGE_SIZE);
            const pagOpDoneCall = opDoneCallRows.slice((opDoneCallPage - 1) * PAGE_SIZE, opDoneCallPage * PAGE_SIZE);
            const pagOpDoneClient = opDoneClientRows.slice((opDoneClientPage - 1) * PAGE_SIZE, opDoneClientPage * PAGE_SIZE);

            // Row Generation
            pagOpSrv.forEach(c => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${c.id || '-'}</strong></td>
                    <td>${c._displayCaseDate || '-'}</td>
                    <td>${c.data?.tsNumber || '-'}</td>
                    <td>${c.department || 'Bilinmiyor'}</td>
                    <td>${c.data?.customer || '-'}</td>
                    <td>${c.data?.name || '-'}</td>
                    <td>${c.data?.serviceType || '-'}</td>
                    <td>${c.data?.provider || '-'}</td>
                    <td>
                        <button class="btn-primary" style="padding: 6px 12px; font-size: 0.8rem; background: #e74c3c;" onclick="viewComplaintDetails('${c.id}')">
                            <i class="fas fa-eye"></i> İncele
                        </button>
                    </td>
                `;
                srvOpinionsBody.appendChild(tr);
            });

            pagOpCall.forEach(c => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${c.id || '-'}</strong></td>
                    <td>${c.date}</td>
                    <td>${c.department || 'Bilinmiyor'}</td>
                    <td>${c.data?.customer || '-'}</td>
                    <td>${c.data?.name || '-'}</td>
                    <td>${c.data?.phone || '-'}</td>
                    <td>
                        <button class="btn-primary" style="padding: 6px 12px; font-size: 0.8rem; background: #e74c3c;" onclick="viewComplaintDetails('${c.id}')">
                            <i class="fas fa-eye"></i> İncele
                        </button>
                    </td>
                `;
                callOpinionsBody.appendChild(tr);
            });

            pagOpDoneSrv.forEach(c => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${c.id || '-'}</strong></td>
                    <td>${c._displayCaseDate || '-'}</td>
                    <td>${c.data?.tsNumber || '-'}</td>
                    <td>${c.data?.customer || '-'}</td>
                    <td>${c.data?.name || '-'}</td>
                    <td>${c.data?.serviceType || '-'}</td>
                    <td>${c.data?.provider || '-'}</td>
                    <td>
                        <button class="btn-primary" style="padding: 6px 12px; font-size: 0.8rem; background: #27ae60;" onclick="viewComplaintDetails('${c.id}')">
                            <i class="fas fa-eye"></i> İncele
                        </button>
                    </td>
                `;
                if (srvOpinionsDoneBody) srvOpinionsDoneBody.appendChild(tr);
            });

            pagOpDoneCall.forEach(c => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${c.id || '-'}</strong></td>
                    <td>${c.date}</td>
                    <td>${c.data?.customer || '-'}</td>
                    <td>${c.data?.name || '-'}</td>
                    <td>${c.data?.phone || '-'}</td>
                    <td>
                        <button class="btn-primary" style="padding: 6px 12px; font-size: 0.8rem; background: #27ae60;" onclick="viewComplaintDetails('${c.id}')">
                            <i class="fas fa-eye"></i> İncele
                        </button>
                    </td>
                `;
                if (callOpinionsDoneBody) callOpinionsDoneBody.appendChild(tr);
            });

            pagOpClient.forEach(c => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${c.id || '-'}</strong></td>
                    <td>${c.date}</td>
                    <td>${c.department || 'Bilinmiyor'}</td>
                    <td>${c.data?.customer || '-'}</td>
                    <td>${c.data?.policyNo || '-'}</td>
                    <td>${c.data?.name || '-'}</td>
                    <td>
                        <button class="btn-primary" style="padding: 6px 12px; font-size: 0.8rem; background: #e74c3c;" onclick="viewComplaintDetails('${c.id}')">
                            <i class="fas fa-eye"></i> İncele
                        </button>
                    </td>
                `;
                if (clientOpinionsBody) clientOpinionsBody.appendChild(tr);
            });

            pagOpDoneClient.forEach(c => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${c.id || '-'}</strong></td>
                    <td>${c.date}</td>
                    <td>${c.data?.customer || '-'}</td>
                    <td>${c.data?.name || '-'}</td>
                    <td>${c.data?.policyNo || '-'}</td>
                    <td>
                        <button class="btn-primary" style="padding: 6px 12px; font-size: 0.8rem; background: #27ae60;" onclick="viewComplaintDetails('${c.id}')">
                            <i class="fas fa-eye"></i> İncele
                        </button>
                    </td>
                `;
                if (clientOpinionsDoneBody) clientOpinionsDoneBody.appendChild(tr);
            });

            // Empty state check
            if (opSrvRows.length === 0) srvOpinionsBody.innerHTML = `<tr><td colspan="8" class="table-empty">Bekleyen Hizmet Şikayeti görüş talebi bulunmamaktadır.</td></tr>`;
            if (opCallRows.length === 0) callOpinionsBody.innerHTML = `<tr><td colspan="6" class="table-empty">Bekleyen Çağrı Şikayeti görüş talebi bulunmamaktadır.</td></tr>`;
            if (opClientRows.length === 0 && clientOpinionsBody) clientOpinionsBody.innerHTML = `<tr><td colspan="6" class="table-empty">Bekleyen Dış Müşteri Şikayeti görüş talebi bulunmamaktadır.</td></tr>`;
            
            if (opDoneSrvRows.length === 0 && srvOpinionsDoneBody) srvOpinionsDoneBody.innerHTML = `<tr><td colspan="7" class="table-empty">Cevaplanmış Hizmet Şikayeti bulunmamaktadır.</td></tr>`;
            if (opDoneCallRows.length === 0 && callOpinionsDoneBody) callOpinionsDoneBody.innerHTML = `<tr><td colspan="5" class="table-empty">Cevaplanmış Çağrı Şikayeti bulunmamaktadır.</td></tr>`;
            if (opDoneClientRows.length === 0 && clientOpinionsDoneBody) clientOpinionsDoneBody.innerHTML = `<tr><td colspan="5" class="table-empty">Cevaplanmış Dış Müşteri Şikayeti bulunmamaktadır.</td></tr>`;

            // Update Badges
            const badge1 = document.getElementById('opinions-badge');
            const badge2 = document.getElementById('opinions-badge-2');
            if (badge1) { badge1.textContent = pendingOpinionsCount; badge1.style.display = pendingOpinionsCount > 0 ? 'inline-block' : 'none'; }
            if (badge2) { badge2.textContent = pendingOpinionsCount; badge2.style.display = pendingOpinionsCount > 0 ? 'inline-block' : 'none'; }

        } // end of isAdmin opinions block

        // Expose globally for Excel export regardless of user role
        window.currentFilteredData = {
            srv: srvRows,
            call: callRows,
            client: clientRows,
            opSrv: opSrvRows,
            opCall: opCallRows,
            opClient: opClientRows,
            opDoneSrv: opDoneSrvRows,
            opDoneCall: opDoneCallRows,
            opDoneClient: opDoneClientRows
        };
    }
    // Bind Filter Listeners
    setTimeout(() => {
        const filterInputs = document.querySelectorAll('.filters-container input, .filters-container select');
        filterInputs.forEach(input => {
            input.oninput = renderDashboard;
            input.onchange = renderDashboard;
        });

        // Bind Sortable Headers
        document.addEventListener('click', (e) => {
            const th = e.target.closest('th[data-sort]');
            if (!th) return;

            const table = th.getAttribute('data-table');
            const key = th.getAttribute('data-sort');

            if (table === 'srv') {
                if (srvSort.key === key) srvSort.dir = srvSort.dir === 'asc' ? 'desc' : 'asc';
                else { srvSort.key = key; srvSort.dir = 'desc'; }
            } else if (table === 'call') {
                if (callSort.key === key) callSort.dir = callSort.dir === 'asc' ? 'desc' : 'asc';
                else { callSort.key = key; callSort.dir = 'desc'; }
            } else if (table === 'client') {
                if (clientSort.key === key) clientSort.dir = clientSort.dir === 'asc' ? 'desc' : 'asc';
                else { clientSort.key = key; clientSort.dir = 'desc'; }
            } else if (table === 'opSrv') {
                if (opSrvSort.key === key) opSrvSort.dir = opSrvSort.dir === 'asc' ? 'desc' : 'asc';
                else { opSrvSort.key = key; opSrvSort.dir = 'desc'; }
            } else if (table === 'opCall') {
                if (opCallSort.key === key) opCallSort.dir = opCallSort.dir === 'asc' ? 'desc' : 'asc';
                else { opCallSort.key = key; opCallSort.dir = 'desc'; }
            } else if (table === 'opClient') {
                if (opClientSort.key === key) opClientSort.dir = opClientSort.dir === 'asc' ? 'desc' : 'asc';
                else { opClientSort.key = key; opClientSort.dir = 'desc'; }
            } else if (table === 'opDoneSrv') {
                if (opDoneSrvSort.key === key) opDoneSrvSort.dir = opDoneSrvSort.dir === 'asc' ? 'desc' : 'asc';
                else { opDoneSrvSort.key = key; opDoneSrvSort.dir = 'desc'; }
            } else if (table === 'opDoneCall') {
                if (opDoneCallSort.key === key) opDoneCallSort.dir = opDoneCallSort.dir === 'asc' ? 'desc' : 'asc';
                else { opDoneCallSort.key = key; opDoneCallSort.dir = 'desc'; }
            } else if (table === 'opDoneClient') {
                if (opDoneClientSort.key === key) opDoneClientSort.dir = opDoneClientSort.dir === 'asc' ? 'desc' : 'asc';
                else { opDoneClientSort.key = key; opDoneClientSort.dir = 'desc'; }
            }

            renderDashboard();
        });
    }, 500);


    // --- Details View Logic ---
    const detailModal = document.getElementById('complaint-detail-modal');
    const closeDetailModalBtn = document.getElementById('close-detail-modal');

    if(closeDetailModalBtn) {
        closeDetailModalBtn.addEventListener('click', () => {
            detailModal.classList.remove('show');
            setTimeout(() => detailModal.classList.add('hidden'), 300);
        });
    }

    window.viewComplaintDetails = function(id) {
        const item = savedComplaints.find(c => c.id === id);
        if(!item) return;

        // Ensure modal elements exist
        const safeDetailModal = document.getElementById('complaint-detail-modal');
        if(!safeDetailModal) return;

        // Populate Summary
        document.getElementById('detail-complaint-id').textContent = item.id;
        document.getElementById('detail-status-badge').textContent = item.status;
        document.getElementById('detail-type').textContent = item.type;
        document.getElementById('detail-reason').textContent = item.reason;
        document.getElementById('detail-author').textContent = item.author;
        
        const deptWrapper = document.getElementById('detail-author-dept-wrapper');
        const respWrapper = document.getElementById('detail-responsible-wrapper');
        const verdictWrapper = document.getElementById('detail-verdict-wrapper');
        const logsSection = document.getElementById('detail-logs-section');
        const querySection = document.getElementById('detail-authority-query-section');

        if (querySection) {
            // Identify if this is a Client Complaint by checking for policyNo, and verify the user is an Authority
            if (item.data && item.data.policyNo && globalUser && globalUser.isAuthority) {
                querySection.style.display = 'block';
                querySection.setAttribute('data-current-id', item.id);
            } else {
                querySection.style.display = 'none';
            }
        }

        if (globalUser && globalUser.isClient) {
            if (deptWrapper) deptWrapper.style.display = 'none';
            if (respWrapper) respWrapper.style.display = 'none';
            if (logsSection) logsSection.style.display = 'none';
        } else {
            if (deptWrapper) deptWrapper.style.display = 'block';
            if (respWrapper) respWrapper.style.display = 'block';
            if (logsSection) logsSection.style.display = 'block';
            
            const deptEl = document.getElementById('detail-author-dept');
            if (deptEl) deptEl.textContent = item.department || 'Bilinmiyor';
            
            const respEl = document.getElementById('detail-responsible');
            if (respEl) respEl.innerHTML = `<i class="fas fa-user-shield"></i> ${item.responsible || '-'}`;
        }

        // Display "Şikayet Sonucu" (Verdict) if Concluded
        let foundVerdict = null;
        let foundDept = null;
        let foundNote = null;

        if (item.data && item.data.conclusion) {
            foundVerdict = item.data.conclusion.verdict;
            foundDept = item.data.conclusion.department;
            foundNote = item.data.conclusion.note;
        } else if (item.status === 'Şikayet Sonuçlandı' && item.logs && Array.isArray(item.logs)) {
            // Find in logs from end to start for older records
            for (let i = item.logs.length - 1; i >= 0; i--) {
                const actionText = item.logs[i].action || "";
                if (actionText.includes('Sonuçlandırıldı')) {
                    const matchVerdict = actionText.match(/\[(.*?)\]/);
                    const matchDept = actionText.match(/\((.*?)\)/);
                    if (matchVerdict) foundVerdict = matchVerdict[1];
                    if (matchDept) foundDept = matchDept[1];
                    break;
                }
                if (actionText.includes('Sonuç: Haklı')) {
                    foundVerdict = 'Haklı / Şirket Hatası';
                    break;
                } else if (actionText.includes('Sonuç: Haksız')) {
                    foundVerdict = 'Haksız / Sigortalı Haksız';
                    break;
                } else if (actionText.includes('Haklı') && !actionText.includes('Haksız')) {
                    foundVerdict = 'Haklı / Şirket Hatası';
                    break;
                }
            }
        }

        if (verdictWrapper) {
            const verdictTextEl = document.getElementById('detail-verdict');
            const verdictDeptEl = document.getElementById('detail-conclusion-dept');
            const verdictNoteEl = document.getElementById('detail-conclusion-note');

            if (foundVerdict) {
                verdictWrapper.style.display = 'block';
                if (verdictTextEl) {
                    verdictTextEl.textContent = foundVerdict;
                    verdictTextEl.style.color = foundVerdict.includes('Haklı') ? '#e74c3c' : '#27ae60';
                }
                if (verdictDeptEl) {
                    verdictDeptEl.textContent = foundDept || '-';
                }
                if (verdictNoteEl) {
                    verdictNoteEl.textContent = foundNote || '-';
                }
            } else {
                verdictWrapper.style.display = 'none';
            }
        }        
        let displayDate = item.date || '-';
        if (typeof displayDate === 'string' && displayDate.indexOf('Date(') !== -1) {
            try {
                const match = displayDate.match(/Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)/);
                if (match) {
                    const dateObj = new Date(match[1], match[2], match[3], match[4] || 0, match[5] || 0);
                    displayDate = `${String(dateObj.getDate()).padStart(2, '0')}.${String(dateObj.getMonth() + 1).padStart(2, '0')}.${dateObj.getFullYear()} ${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}`;
                }
            } catch(e) {}
        }
        document.getElementById('detail-date').textContent = displayDate;

        // Keep track of currently viewed item id on the modal element
        safeDetailModal.setAttribute('data-current-id', item.id);

        // Toggle Authority Buttons View (Hidden for non-experts)
        const actionSection = document.getElementById('detail-action-buttons');
        if (actionSection) {
            if (globalUser && globalUser.isAuthority === true) {
                actionSection.classList.remove('hidden');
                actionSection.style.display = 'block';

                const btnTake = document.getElementById('action-take-btn');
                const btnRelease = document.getElementById('action-release-btn');
                const btnReq = document.getElementById('action-request-btn');
                const btnConc = document.getElementById('action-conclude-btn');
                const btnReopen = document.getElementById('action-reopen-btn');

                const isTaken = !!item.responsible;
                const myName = globalUser ? (globalUser["Ad Soyad"] || "Yetkili") : 'Sistem Görevlisi';
                const isMine = isTaken && item.responsible === myName;

                if (item.status === 'Şikayet Sonuçlandı' || item.status === 'Dosya Sonuçlandı') {
                    if (btnTake) btnTake.style.display = 'none';
                    if (btnRelease) btnRelease.style.display = 'none';
                    if (btnReq) btnReq.style.display = 'none';
                    if (btnConc) btnConc.style.display = 'none';
                    if (btnReopen) btnReopen.style.display = 'inline-block';
                } else {
                    if (isTaken) {
                        if (btnTake) btnTake.style.display = 'none';
                        if (btnRelease) btnRelease.style.display = isMine ? 'inline-block' : 'none';
                        if (btnReq) btnReq.style.display = 'inline-block';
                        if (btnConc) btnConc.style.display = 'inline-block';
                    } else {
                        if (btnTake) btnTake.style.display = 'inline-block';
                        if (btnRelease) btnRelease.style.display = 'none';
                        if (btnReq) btnReq.style.display = 'none';
                        if (btnConc) btnConc.style.display = 'none';
                    }
                    if (btnReopen) btnReopen.style.display = 'none';
                }

                // Allow visible buttons to be fully clickable
                const buttons = actionSection.querySelectorAll('button');
                buttons.forEach(btn => {
                    btn.disabled = false;
                    btn.style.opacity = '1';
                    btn.style.cursor = 'pointer';
                });
                
                const btnObject = document.getElementById('action-object-btn');
                if (btnObject) btnObject.style.display = 'none';
            } else if (globalUser && globalUser.isClient === true && item.status === 'Şikayet Sonuçlandı') {
                actionSection.classList.remove('hidden');
                actionSection.style.display = 'block';

                const btnTake = document.getElementById('action-take-btn');
                const btnReq = document.getElementById('action-request-btn');
                const btnConc = document.getElementById('action-conclude-btn');
                const btnReopen = document.getElementById('action-reopen-btn');
                
                if (btnTake) btnTake.style.display = 'none';
                if (btnReq) btnReq.style.display = 'none';
                if (btnConc) btnConc.style.display = 'none';
                if (btnReopen) btnReopen.style.display = 'none';
                
                const btnObject = document.getElementById('action-object-btn');
                if (btnObject) {
                    btnObject.style.display = 'inline-block';
                    btnObject.disabled = false;
                    btnObject.style.opacity = '1';
                }
            } else {
                actionSection.classList.add('hidden');
                actionSection.style.display = 'none';
            }
        }

        // Label Maps
        const fieldLabels = {
            customer: 'Müşteri / Kurum',
            name: 'İsim Soyisim',
            phone: 'Telefon No',
            assistFile: 'Asistans Dosya No',
            damageFile: 'Hasar Dosya No',
            tsNumber: 'Dosya No (TS)',
            caseNo: 'Hizmet No',
            caseDate: 'Açılış Tarihi',
            location: 'Lokasyon / Şehir',
            serviceType: 'Hizmet Türü',
            provider: 'Tedarikçi',
            incidentDate: 'Olay Tarihi',
            policyNo: 'Poliçe No'
        };

        // Populate Data Grid
        const grid = document.getElementById('detail-data-grid');
        grid.innerHTML = ''; // clear

        for (const [key, val] of Object.entries(item.data || {})) {
            if (key === 'complaintText' || key === 'opNote' || key === 'opinionRequests' || key === 'conclusion' || key === 'caseDate' || key === 'isClient') continue;
            
            let normalizedKey = key;
            if (key.toLowerCase() === 'incidentdate') normalizedKey = 'incidentDate';
            if (key.toLowerCase() === 'policyno' || key.toLowerCase() === 'polıce no' || key.toLowerCase() === 'policeno') normalizedKey = 'policyNo';

            const label = fieldLabels[normalizedKey] || key;
            let displayVal = val || '-';

            // Google Sheets raw date format workaround matching legacy buggy test records
            if (typeof displayVal === 'string' && displayVal.indexOf('Date(') !== -1) {
                try {
                    const match = displayVal.match(/Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)/);
                    if (match) {
                        const dateObj = new Date(match[1], match[2], match[3], match[4] || 0, match[5] || 0);
                        displayVal = `${String(dateObj.getDate()).padStart(2, '0')}.${String(dateObj.getMonth() + 1).padStart(2, '0')}.${dateObj.getFullYear()} ${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}`;
                    }
                } catch(e) {
                    console.error("Date parse error", e);
                }
            }
            
            if (normalizedKey === 'incidentDate' && displayVal !== '-' && displayVal.indexOf('T') !== -1) {
                try {
                    const dateObj = new Date(displayVal);
                    if (!isNaN(dateObj.getTime())) {
                        displayVal = `${String(dateObj.getDate()).padStart(2, '0')}.${String(dateObj.getMonth() + 1).padStart(2, '0')}.${dateObj.getFullYear()} ${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}`;
                    }
                } catch(e) {}
            }
            
            const div = document.createElement('div');
            div.className = 'form-group';
            div.style.width = '100%';
            div.innerHTML = `
                <label style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: 5px; display: block;">${label}</label>
                <div style="background: var(--bg-light); padding: 10px 15px; border-radius: 8px; font-size: 0.95rem; color: var(--text-dark); border: 1px solid rgba(0,0,0,0.05); min-height: 24px; word-break: break-word; width: 100%;">${displayVal}</div>
            `;
            grid.appendChild(div);
        }

        // Text Fields
        document.getElementById('detail-complaint-text').textContent = item.data?.complaintText || '-';
        document.getElementById('detail-op-note').textContent = item.data?.opNote || '-';

        // Render Logs Dynamically
        const logsList = document.getElementById('detail-logs-list');
        logsList.innerHTML = '';
        if (item.logs && Array.isArray(item.logs) && item.logs.length > 0) {
            item.logs.forEach((log, index) => {
                const li = document.createElement('li');
                if (index === item.logs.length - 1) li.style.borderBottom = 'none';

                let color = "var(--primary-orange)";
                if (log.action.includes("İnceleniyor")) color = "#2980b9";
                else if (log.action.includes("Bekleniyor")) color = "#f39c12";
                else if (log.action.includes("Sonuçlandı") || log.action.includes("Alındı")) color = "#2ecc71";
                else if (log.action.includes("Haklı") && !log.action.includes("Haksız")) color = "#e74c3c"; // Şube Hatalı = Kırmızı

                li.innerHTML = `
                    <span style="display:inline-block; width: 130px; color: var(--text-dark); font-size: 0.85rem;">${log.date}</span>
                    <span style="color: ${color}; font-size: 0.85rem;">${log.action}</span> - <i style="font-size: 0.8rem; color: var(--text-muted);">&nbsp; ${log.user}</i>
                `;
                logsList.appendChild(li);
            });
        } else {
            // Fallback backward compatibility for older hardcoded testing entries
            logsList.innerHTML = `
                <li>
                    <span style="display:inline-block; width: 130px; color: var(--text-dark); font-size: 0.85rem;">${item.date}</span>
                    <span style="color: var(--primary-orange); font-size: 0.85rem;">Kayıt Oluşturuldu</span> - <i style="font-size: 0.8rem; color: var(--text-muted);">${item.author}</i>
                </li>
            `;
        }

        // Render Files if any
        const filesContainer = document.getElementById('detail-files-container');
        if (filesContainer) {
            filesContainer.innerHTML = '';
            if (item.files && item.files.length > 0) {
                item.files.forEach((file, index) => {
                    const btn = document.createElement('a');
                    btn.href = file.data;
                    btn.download = file.name;
                    btn.className = 'btn-secondary';
                    btn.style.cssText = 'display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; font-size: 0.85rem; text-decoration: none;';
                    btn.innerHTML = `<i class="fas fa-download"></i> ${file.name}`;
                    filesContainer.appendChild(btn);
                });
            } else {
                filesContainer.innerHTML = '<span style="color: var(--text-muted); font-size: 0.85rem; font-style: italic;">Eklenen evrak bulunmamaktadır.</span>';
            }
        }

        // --- Opinions Logic ---
        const opinionsSection = document.getElementById('detail-opinions-section');
        const opinionsList = document.getElementById('detail-opinions-list');
        const opinionFormSection = document.getElementById('detail-opinion-form-section');
        const inlineOpinionForm = document.getElementById('inline-opinion-answer-form');
        
        let hasPendingForMe = false;
        let pendingReqIndex = -1;

        if (opinionsSection && opinionFormSection) {
            opinionsSection.classList.add('hidden');
            opinionFormSection.classList.add('hidden');
            opinionsList.innerHTML = '';
            
            if (item.data && Array.isArray(item.data.opinionRequests) && item.data.opinionRequests.length > 0) {
                // Show opinions section
                opinionsSection.classList.remove('hidden');
                
                item.data.opinionRequests.forEach((req, index) => {
                    // Check if pending for the current admin
                    if (req.status === 'Bekleniyor' && globalUser && globalUser.isAdmin && req.targetDept === globalUser.department) {
                        if (!req.targetAdmins || req.targetAdmins.length === 0 || req.targetAdmins.includes(globalUser["Ad Soyad"])) {
                            hasPendingForMe = true;
                            pendingReqIndex = index;
                        }
                    }

                    // Render opinion box (even if not answered, show it was asked)
                    const isAnswered = req.status === 'Görüş Verildi' || req.status === 'Cevaplandı';
                    const div = document.createElement('div');
                    div.style.cssText = `background: var(--white); border: 1px solid rgba(0,0,0,0.05); padding: 15px; border-radius: 8px; position: relative; border-left: 4px solid ${isAnswered ? '#27ae60' : '#f39c12'};`;
                    
                    let html = `
                        <div style="display:flex; justify-content: space-between; margin-bottom: 10px;">
                            <strong>Aksiyon: <span style="color: ${isAnswered ? '#27ae60' : '#f39c12'}">${isAnswered ? 'Cevaplandı' : 'Bekleniyor'}</span></strong>
                            <small style="color: var(--text-muted)">Talep: ${req.date}</small>
                        </div>
                        <div style="font-size: 0.9rem; margin-bottom: 5px;"><strong>Şikayet Yetkilisi Notu:</strong> ${req.note}</div>
                        <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 10px;"><i class="fas fa-building"></i> ${req.targetDept} departmanından istenildi.</div>
                    `;

                    if (isAnswered && req.reply) {
                        html += `
                            <hr style="border:0; border-top: 1px solid rgba(0,0,0,0.05); margin: 10px 0;">
                            <div style="font-size: 0.9rem; margin-bottom: 5px;"><strong>${req.reply.by} Cevabı (${req.reply.date}):</strong></div>
                            <div style="background: rgba(46, 204, 113, 0.05); padding: 10px; border-radius: 6px; font-size: 0.9rem;">${req.reply.note}</div>
                        `;
                        if (req.reply.file) {
                            html += `
                            <div style="margin-top: 10px;">
                                <a href="${req.reply.file.data}" download="${req.reply.file.name}" class="btn-secondary" style="font-size: 0.8rem; padding: 4px 8px;"><i class="fas fa-paperclip"></i> Eklentiyi İndir</a>
                            </div>`;
                        }
                    }
                    div.innerHTML = html;
                    opinionsList.appendChild(div);
                });
            }

            if (hasPendingForMe) {
                opinionFormSection.classList.remove('hidden');
                inlineOpinionForm.setAttribute('data-target-id', item.id);
                inlineOpinionForm.setAttribute('data-target-req-index', pendingReqIndex);
                document.getElementById('inline-opinion-answer-note').value = '';
                document.getElementById('inline-opinion-answer-file').value = '';
            }
        }

        // Show Modal
        const safeModal = document.getElementById('complaint-detail-modal');
        if (safeModal) {
            safeModal.classList.remove('hidden');
            void safeModal.offsetWidth;
            safeModal.classList.add('show');
        }
    };

    // --- Authority Action Buttons Logic ---
    const actionTakeBtn = document.getElementById('action-take-btn');

    if (actionTakeBtn) {
        actionTakeBtn.addEventListener('click', async () => {
            if (!globalUser || globalUser.isAuthority !== true) return;
            const proceed = await showConfirmDialog('Şikayeti üzerinize almak istediğinize emin misiniz?');
            if (!proceed) return;

            const safeModal = document.getElementById('complaint-detail-modal');
            const currentId = safeModal.getAttribute('data-current-id');
            const complaintIndex = savedComplaints.findIndex(c => c.id === currentId);

            if (complaintIndex > -1) {
                const now = new Date();
                const dateStr = now.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
                                now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

                savedComplaints[complaintIndex].status = "Şikayet İnceleniyor";
                savedComplaints[complaintIndex].responsible = globalUser ? (globalUser["Ad Soyad"] || "Yetkili") : 'Sistem Görevlisi';
                
                savedComplaints[complaintIndex].logs = savedComplaints[complaintIndex].logs || [];
                savedComplaints[complaintIndex].logs.push({
                    date: dateStr,
                    action: 'Şikayet İnceleniyor (Şikayeti Al)',
                    user: savedComplaints[complaintIndex].responsible
                });

                try {
                    saveComplaintsSafely();
                    renderDashboard();
                    viewComplaintDetails(currentId); // refresh modal UI instantly
                    showNotif('Şikayet başarıyla üzerinize alındı.', 'success');
                } catch (e) {
                    alert('Hata: Kayıt güncellenirken kota aşıldı.');
                }
            }
        });
    }

    const actionReleaseBtn = document.getElementById('action-release-btn');

    if (actionReleaseBtn) {
        actionReleaseBtn.addEventListener('click', async () => {
            if (!globalUser || globalUser.isAuthority !== true) return;
            const proceed = await showConfirmDialog('Şikayeti bırakmak istediğinize emin misiniz? Dosya tekrar "Talep Açıldı" statüsüne dönecektir.');
            if (!proceed) return;

            const safeModal = document.getElementById('complaint-detail-modal');
            const currentId = safeModal.getAttribute('data-current-id');
            const complaintIndex = savedComplaints.findIndex(c => c.id === currentId);

            if (complaintIndex > -1) {
                // Ensure only the assigned person can release it
                const myName = globalUser ? (globalUser["Ad Soyad"] || "Yetkili") : 'Sistem Görevlisi';
                if (savedComplaints[complaintIndex].responsible !== myName) {
                    alert('Bu şikayeti sadece üzerinize almış olan kişi bırakabilir.');
                    return;
                }

                const now = new Date();
                const dateStr = now.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
                                now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

                savedComplaints[complaintIndex].status = "Talep Açıldı";
                savedComplaints[complaintIndex].responsible = ""; // clear responsible
                
                savedComplaints[complaintIndex].logs = savedComplaints[complaintIndex].logs || [];
                savedComplaints[complaintIndex].logs.push({
                    date: dateStr,
                    action: 'Şikayet Bırakıldı (Serbest)',
                    user: myName
                });

                try {
                    saveComplaintsSafely();
                    renderDashboard();
                    viewComplaintDetails(currentId); // refresh modal UI instantly
                    showNotif('Şikayet dosyası serbest bırakıldı.', 'info');
                } catch (e) {
                    alert('Hata: Kayıt güncellenirken kota aşıldı.');
                }
            }
        });
    }

    // --- Request Opinion Logic (Görüş Al) ---
    const actionRequestBtn = document.getElementById('action-request-btn');
    const opinionModal = document.getElementById('opinion-modal');
    const closeOpinionModalBtn = document.getElementById('close-opinion-modal');
    const opinionForm = document.getElementById('opinion-form');
    const opinionDeptSelect = document.getElementById('opinion-dept-select');
    const opinionAdminsGroup = document.getElementById('opinion-admins-group');
    const opinionAdminsList = document.getElementById('opinion-admins-list');

    if (closeOpinionModalBtn) {
        closeOpinionModalBtn.addEventListener('click', (e) => {
            e.preventDefault();
            opinionModal.classList.remove('show');
            setTimeout(() => opinionModal.classList.add('hidden'), 300);
        });
    }

    if (actionRequestBtn) {
        actionRequestBtn.addEventListener('click', () => {
            if (!globalUser || globalUser.isAuthority !== true) return;
            // Populate Departments
            const uniqueDepts = new Set();
            employeeData.forEach(emp => {
                if (emp.department && emp.department.toLowerCase() !== 'departman' && emp.department.toLowerCase() !== 'bilinmiyor') {
                    uniqueDepts.add(emp.department);
                }
            });

            opinionDeptSelect.innerHTML = '<option value="">Departman Seçiniz...</option>';
            [...uniqueDepts].sort().forEach(dept => {
                const opt = document.createElement('option');
                opt.value = dept;
                opt.textContent = dept;
                opinionDeptSelect.appendChild(opt);
            });

            // Reset Form and Admin list
            document.getElementById('opinion-note').value = '';
            opinionAdminsGroup.style.display = 'none';
            opinionAdminsList.innerHTML = '';
            
            // Show Modal
            opinionModal.classList.remove('hidden');
            void opinionModal.offsetWidth;
            opinionModal.classList.add('show');
        });
    }

    // Load Admins when Department changes
    if (opinionDeptSelect) {
        opinionDeptSelect.addEventListener('change', (e) => {
            const selectedDept = e.target.value;
            opinionAdminsList.innerHTML = '';

            if (selectedDept) {
                // permessive filtering: check both normalized property and raw property
                const deptAdmins = employeeData.filter(emp => {
                    const empDept = (emp.department || '').toString().trim();
                    const empIsAdmin = emp.isAdmin === true;
                    return empDept === selectedDept && empIsAdmin;
                });
                
                if (deptAdmins.length > 0) {
                    deptAdmins.forEach((admin, i) => {
                        const name = admin["Ad Soyad"] || "Admin";
                        opinionAdminsList.innerHTML += `
                            <label class="checkbox-container" style="justify-content: flex-start; margin: 0; display: flex; align-items: center; gap: 10px; cursor: pointer;">
                                <input type="checkbox" name="opinion-admin-target" value="${name}" checked style="width: auto; height: auto;">
                                <span style="font-size: 0.95rem; color: var(--text-dark);">${name}</span>
                            </label>
                        `;
                    });
                    opinionAdminsGroup.style.display = 'block';
                } else {
                    opinionAdminsList.innerHTML = '<span style="color:var(--text-muted); font-size:0.85rem;">Bu departmanda Admin yetkili kimse bulunamadı. Talebiniz departmana iletilecektir.</span>';
                    opinionAdminsGroup.style.display = 'block';
                }
            } else {
                opinionAdminsGroup.style.display = 'none';
            }
        });
    }

    // Submit Opinion Request
    if (opinionForm) {
        opinionForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const proceed = await showConfirmDialog('Görüş talebini iletmek istediğinize emin misiniz? Seçilen kişilere panelde bildirim oluşturulacaktır.');
            if (!proceed) return;

            const safeModal = document.getElementById('complaint-detail-modal');
            const currentId = safeModal.getAttribute('data-current-id');
            const complaintIndex = savedComplaints.findIndex(c => c.id === currentId);

            if (complaintIndex > -1) {
                const now = new Date();
                const dateStr = now.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
                                now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

                const targetDept = opinionDeptSelect.value;
                const note = document.getElementById('opinion-note').value.trim();
                
                // Collect selected admins
                const checkboxes = document.querySelectorAll('input[name="opinion-admin-target"]:checked');
                const targetAdmins = Array.from(checkboxes).map(cb => cb.value);

                // Ensure data structure exists
                savedComplaints[complaintIndex].data = savedComplaints[complaintIndex].data || {};
                savedComplaints[complaintIndex].data.opinionRequests = savedComplaints[complaintIndex].data.opinionRequests || [];
                
                // Push new request
                savedComplaints[complaintIndex].data.opinionRequests.push({
                    date: dateStr,
                    from: globalUser ? (globalUser["Ad Soyad"] || "Yetkili") : 'Sistem Görevlisi',
                    targetDept: targetDept,
                    targetAdmins: targetAdmins,
                    note: note,
                    status: 'Bekleniyor', // Pending answer
                    reply: null
                });

                savedComplaints[complaintIndex].status = "Departman'dan Görüş Bekleniyor";
                savedComplaints[complaintIndex].logs = savedComplaints[complaintIndex].logs || [];
                savedComplaints[complaintIndex].logs.push({
                    date: dateStr,
                    action: `Görüş İstendi (${targetDept})`,
                    user: globalUser ? (globalUser["Ad Soyad"] || "Yetkili") : 'Sistem Görevlisi'
                });

                try {
                    saveComplaintsSafely();
                    opinionModal.classList.remove('show');
                    setTimeout(() => opinionModal.classList.add('hidden'), 300);
                    renderDashboard();
                    
                    // (Email hook restricted per user request)

                    viewComplaintDetails(currentId);
                    showNotif('Talebiniz departmana başarıyla iletildi.', 'success');
                } catch (e) {
                    alert('Hata: Kayıt güncellenirken kota aşıldı.');
                }
            }
        });
    }

    // --- Answer Opinion Logic (Görüş Bildir) Inline ---
    const inlineOpinionForm = document.getElementById('inline-opinion-answer-form');
    
    if (inlineOpinionForm) {
        inlineOpinionForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const proceed = await showConfirmDialog('Görüşünüzü bildirmek istediğinize emin misiniz?');
            if (!proceed) return;

            const targetId = inlineOpinionForm.getAttribute('data-target-id');
            const reqIndex = parseInt(inlineOpinionForm.getAttribute('data-target-req-index'), 10);
            
            const complaintIndex = savedComplaints.findIndex(c => c.id === targetId);
            if (complaintIndex > -1 && savedComplaints[complaintIndex].data && savedComplaints[complaintIndex].data.opinionRequests) {
                const req = savedComplaints[complaintIndex].data.opinionRequests[reqIndex];
                const myName = globalUser ? (globalUser["Ad Soyad"] || "Yetkili") : 'Sistem Görevlisi';
                const myDept = globalUser ? globalUser.department : 'Departman';
                
                const now = new Date();
                const dateStr = now.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
                                now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

                const answerNote = document.getElementById('inline-opinion-answer-note').value.trim();
                const fileInput = document.getElementById('inline-opinion-answer-file');
                let answerFile = null;

                const saveAndProceed = () => {
                    // Update Request Status
                    req.status = 'Cevaplandı'; // Indicates this specific request is answered
                    req.reply = {
                        date: dateStr,
                        by: myName,
                        note: answerNote,
                        file: answerFile
                    };

                    // Check if all requests are answered to update the main Complaint Status
                    const allReqs = savedComplaints[complaintIndex].data.opinionRequests;
                    const allAnswered = allReqs.every(r => r.status === 'Cevaplandı');
                    
                    if (allAnswered) {
                        savedComplaints[complaintIndex].status = "Departman Görüşü Bildirildi";
                    }

                    // Log Action
                    savedComplaints[complaintIndex].logs = savedComplaints[complaintIndex].logs || [];
                    savedComplaints[complaintIndex].logs.push({
                        date: dateStr,
                        action: `Departmandan Görüş Bildirildi (${myDept})`,
                        user: myName
                    });

                    try {
                        saveComplaintsSafely();
                        renderDashboard();

                        // (Email hook restricted per user request)

                        viewComplaintDetails(targetId); // Force re-render of modal to reflect changes
                        showNotif('Görüş başarıyla bildirildi.', 'success');
                    } catch (e) {
                        alert('Hata: Kayıt güncellenirken kota aşıldı.');
                    }
                };

                // Handle File if exists (reusing Base64 Logic)
                if (fileInput && fileInput.files && fileInput.files.length > 0) {
                    const file = fileInput.files[0];
                    if (file.size > 2 * 1024 * 1024) {
                        alert("Dosya boyutu kısıtlaması: Maksimum 2MB.");
                        return;
                    }
                    const reader = new FileReader();
                    reader.onload = function(e) {
                        answerFile = {
                            name: file.name,
                            type: file.type,
                            data: e.target.result
                        };
                        saveAndProceed();
                    };
                    reader.readAsDataURL(file);
                } else {
                    saveAndProceed();
                }
            }
        });
    }
    // --- Conclude Complaint Logic (Şikayeti Sonuçlandır) ---
    const actionConcludeBtn = document.getElementById('action-conclude-btn');
    const concludeModal = document.getElementById('conclude-modal');
    const closeConcludeModalBtn = document.getElementById('close-conclude-modal');
    const concludeForm = document.getElementById('conclude-form');
    const concludeDeptSelect = document.getElementById('conclude-dept-select');

    if (closeConcludeModalBtn) {
        closeConcludeModalBtn.addEventListener('click', (e) => {
            e.preventDefault();
            concludeModal.classList.remove('show');
            setTimeout(() => concludeModal.classList.add('hidden'), 300);
        });
    }

    if (actionConcludeBtn) {
        actionConcludeBtn.addEventListener('click', () => {
            if (!globalUser || globalUser.isAuthority !== true) return;
            // Populate Departments list (re-using the logic from Requests)
            const uniqueDepts = new Set();
            employeeData.forEach(emp => {
                if (emp.department && emp.department.toLowerCase() !== 'departman' && emp.department.toLowerCase() !== 'bilinmiyor') {
                    uniqueDepts.add(emp.department);
                }
            });

            concludeDeptSelect.innerHTML = '<option value="">Departman Seçiniz...</option>';
            [...uniqueDepts].sort().forEach(dept => {
                const opt = document.createElement('option');
                opt.value = dept;
                opt.textContent = dept;
                concludeDeptSelect.appendChild(opt);
            });

            // Reset form
            document.getElementById('conclude-status-select').value = '';
            document.getElementById('conclude-status-select').style.color = 'var(--text-dark)';
            document.getElementById('conclude-status-select').style.fontWeight = 'normal';
            document.getElementById('conclude-note').value = '';

            // Show Modal
            concludeModal.classList.remove('hidden');
            void concludeModal.offsetWidth;
            concludeModal.classList.add('show');
        });
    }

    if (concludeForm) {
        concludeForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const proceed = await showConfirmDialog('Şikayeti kalıcı olarak sonuçlandırmak istediğinize emin misiniz? (Bu işlem geri alınamaz)');
            if (!proceed) return;

            const safeModal = document.getElementById('complaint-detail-modal');
            const currentId = safeModal.getAttribute('data-current-id');
            const complaintIndex = savedComplaints.findIndex(c => c.id === currentId);

            if (complaintIndex > -1) {
                const now = new Date();
                const dateStr = now.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
                                now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

                const targetDept = concludeDeptSelect.value;
                const statusSelect = document.getElementById('conclude-status-select').value;
                const concludeNote = document.getElementById('conclude-note').value.trim();
                const myName = globalUser ? (globalUser["Ad Soyad"] || "Yetkili") : 'Sistem Görevlisi';

                // Save Final Conclusion Details
                savedComplaints[complaintIndex].data = savedComplaints[complaintIndex].data || {};
                savedComplaints[complaintIndex].data.conclusion = {
                    date: dateStr,
                    by: myName,
                    department: targetDept,
                    verdict: statusSelect, // Haklı or Haksız
                    note: concludeNote
                };

                // Update Overall Status and hide from active processing
                savedComplaints[complaintIndex].status = "Şikayet Sonuçlandı";

                // Auto-cancel any "Bekleniyor" opinion requests
                if (Array.isArray(savedComplaints[complaintIndex].data.opinionRequests)) {
                    savedComplaints[complaintIndex].data.opinionRequests.forEach(req => {
                        if (req.status === 'Bekleniyor') {
                            req.status = 'İptal Edildi';
                            req.reply = {
                                date: dateStr,
                                by: "Sistem",
                                note: "Şikayet sonuçlandırıldığı için görüş talebi otomatik iptal edildi."
                            };
                        }
                    });
                }

                // Add to System Logs
                savedComplaints[complaintIndex].logs = savedComplaints[complaintIndex].logs || [];
                savedComplaints[complaintIndex].logs.push({
                    date: dateStr,
                    action: `Sonuçlandırıldı [${statusSelect}] (${targetDept})`,
                    user: myName
                });

                try {
                    saveComplaintsSafely();
                    concludeModal.classList.remove('show');
                    setTimeout(() => concludeModal.classList.add('hidden'), 300);
                    renderDashboard();
                    
                    // (Email Trigger explicitly removed)

                    // Re-render Details modal since status changed
                    viewComplaintDetails(currentId);
                    
                    showNotif('Şikayet dosyası başarıyla kapatıldı.', 'success');
                } catch (e) {
                    alert('Hata: Kayıt güncellenirken kota aşıldı.');
                }
            }
        });
    }

    // --- Reopen Complaint Logic (Şikayeti Yeniden Aç) ---
    const actionReopenBtn = document.getElementById('action-reopen-btn');
    if (actionReopenBtn) {
        actionReopenBtn.addEventListener('click', async () => {
            if (!globalUser || globalUser.isAuthority !== true) return;
            
            const proceed = await showConfirmDialog('Şikayeti tekrar incelemeye almak istediğinize emin misiniz?\nDurumu "Şikayet Yeniden İnceleniyor" olarak güncellenecektir.');
            if (!proceed) return;

            const safeModal = document.getElementById('complaint-detail-modal');
            const currentId = safeModal.getAttribute('data-current-id');
            const complaintIndex = savedComplaints.findIndex(c => c.id === currentId);

            if (complaintIndex > -1) {
                const now = new Date();
                const dateStr = now.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
                                now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
                
                const myName = globalUser ? (globalUser["Ad Soyad"] || "Yetkili") : 'Sistem Görevlisi';

                // Update Status
                savedComplaints[complaintIndex].status = "Şikayet Yeniden İnceleniyor";

                // Add to System Logs
                savedComplaints[complaintIndex].logs = savedComplaints[complaintIndex].logs || [];
                savedComplaints[complaintIndex].logs.push({
                    date: dateStr,
                    action: `Şikayet Yeniden Açıldı`,
                    user: myName
                });

                try {
                    saveComplaintsSafely();
                    renderDashboard();
                    
                    // Re-render Details modal since status changed
                    viewComplaintDetails(currentId);
                    
                    showNotif('Şikayet dosyası yeniden incelemeye açıldı.', 'success');
                } catch (e) {
                    alert('Hata: Kayıt güncellenirken kota aşıldı.');
                }
            }
        });
    }

    // --- Objection (Sonuca İtiraz Et) Logic ---
    const actionObjectBtn = document.getElementById('action-object-btn');
    if (actionObjectBtn) {
        actionObjectBtn.addEventListener('click', async () => {
            if (!globalUser || globalUser.isClient !== true) return;
            
            const { value: reason } = await Swal.fire({
                title: 'Sonuca İtiraz Et',
                input: 'textarea',
                inputLabel: 'Lütfen itiraz sebebinizi detaylıca belirtiniz:',
                inputPlaceholder: 'Örn: Verilen karar mağduriyetimi gidermedi...',
                inputAttributes: {
                    'aria-label': 'İtiraz sebebini yazın'
                },
                showCancelButton: true,
                confirmButtonText: '<i class="fas fa-paper-plane"></i> Gönder',
                cancelButtonText: 'İptal',
                confirmButtonColor: '#c0392b',
                cancelButtonColor: '#95a5a6',
                inputValidator: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'İtiraz sebebi girmek zorunludur!';
                    }
                }
            });

            if (reason) {
                const safeModal = document.getElementById('complaint-detail-modal');
                const currentId = safeModal.getAttribute('data-current-id');
                const complaintIndex = savedComplaints.findIndex(c => c.id === currentId);

                if (complaintIndex > -1) {
                    const now = new Date();
                    const dateStr = now.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
                                    now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
                    
                    const myName = globalUser ? (globalUser.companyName || "Dış Müşteri") : 'Dış Müşteri';

                    // Update Status to objection status
                    savedComplaints[complaintIndex].status = "Şikayet Sonucuna İtiraz Edildi";

                    // Log the objection
                    savedComplaints[complaintIndex].logs = savedComplaints[complaintIndex].logs || [];
                    savedComplaints[complaintIndex].logs.push({
                        date: dateStr,
                        action: `Sonuca İtiraz Edildi`,
                        note: `İtiraz Sebebi: ${reason}`,
                        user: myName
                    });

                    try {
                        saveComplaintsSafely();
                        renderDashboard();
                        
                        viewComplaintDetails(currentId);
                        
                        showNotif('İtirazınız yetkili birimlere başarıyla iletildi.', 'success');
                    } catch (e) {
                        alert('Hata: Kayıt güncellenirken kota aşıldı.');
                    }
                }
            }
        });
    }

    // --- Excel (XLSX) Export Logic ---
    function exportToExcel(dataArray, type) {
        if (!dataArray || dataArray.length === 0) return;
        
        let rows = [];

        dataArray.forEach(item => {
            const row = {};
            
            // 1. Table Specific Base Columns
            if (type === 'srv') {
                row["Şikayet No"] = item.id || '';
                row["Statü"] = item.status || '';
                row["Departman"] = item.department || '';
                row["Oluşturulma Tarihi"] = item.date || '';
                row["Dosya No"] = item.data?.tsNumber || '';
                row["Açılış Tarihi"] = item._displayCaseDate || item.data?.caseDate || '';
                row["Müşteri"] = item.data?.customer || '';
                row["Sigortalı Adı"] = item.data?.name || '';
                row["Telefon"] = item.data?.phone || '';
                row["Hizmet Türü"] = item.data?.serviceType || '';
                row["Tedarikçi"] = item.data?.provider || '';
            } else if (type === 'call') {
                row["Şikayet No"] = item.id || '';
                row["Statü"] = item.status || '';
                row["Departman"] = item.department || '';
                row["Oluşturulma Tarihi"] = item.date || '';
                row["Müşteri"] = item.data?.customer || '';
                row["İsim"] = item.data?.name || '';
                row["Telefon"] = item.data?.phone || '';
            } else if (type === 'client') {
                row["Şikayet No"] = item.id || '';
                row["Statü"] = item.status || '';
                row["Departman"] = item.department || '';
                row["Oluşturulma Tarihi"] = item.date || '';
                row["Poliçe No"] = item.data?.policyNo || '';
                row["İsim Soyisim"] = item.data?.name || '';
                row["Telefon"] = item.data?.phone || '';
            } else if (type === 'opSrv') {
                row["Şikayet No"] = item.id || '';
                row["Açılış Tarihi"] = item._displayCaseDate || item.data?.caseDate || '';
                row["Dosya No"] = item.data?.tsNumber || '';
                row["Kaynak"] = item.department || '';
                row["Müşteri"] = item.data?.customer || '';
                row["Sigortalı Adı"] = item.data?.name || '';
                row["Hizmet Türü"] = item.data?.serviceType || '';
                row["Tedarikçi"] = item.data?.provider || '';
            } else if (type === 'opCall') {
                row["Şikayet No"] = item.id || '';
                row["Tarih"] = item.date || '';
                row["Kaynak"] = item.department || '';
                row["Müşteri"] = item.data?.customer || '';
                row["İsim"] = item.data?.name || '';
                row["Telefon"] = item.data?.phone || '';
            } else if (type === 'opClient') {
                row["Şikayet No"] = item.id || '';
                row["Tarih"] = item.date || '';
                row["Kaynak"] = item.department || '';
                row["Kurum"] = item.data?.customer || '';
                row["Poliçe No"] = item.data?.policyNo || '';
                row["İsim"] = item.data?.name || '';
            } else if (type === 'opDoneSrv') {
                row["Şikayet No"] = item.id || '';
                row["Açılış Tarihi"] = item._displayCaseDate || item.data?.caseDate || '';
                row["Dosya No"] = item.data?.tsNumber || '';
                row["Müşteri"] = item.data?.customer || '';
                row["Sigortalı Adı"] = item.data?.name || '';
                row["Hizmet Türü"] = item.data?.serviceType || '';
                row["Tedarikçi"] = item.data?.provider || '';
            } else if (type === 'opDoneCall') {
                row["Şikayet No"] = item.id || '';
                row["Tarih"] = item.date || '';
                row["Müşteri"] = item.data?.customer || '';
                row["İsim"] = item.data?.name || '';
                row["Telefon"] = item.data?.phone || '';
            } else if (type === 'opDoneClient') {
                row["Şikayet No"] = item.id || '';
                row["Tarih"] = item.date || '';
                row["Kurum"] = item.data?.customer || '';
                row["Poliçe No"] = item.data?.policyNo || '';
                row["İsim"] = item.data?.name || '';
            }

            // 2. Extra Details / Internal Notes that were requested broadly
            if (item.data) {
                if (item.data.complaintText) row["Şikayet Metni"] = item.data.complaintText;
                if (item.data.opNote) row["Operasyon Notu"] = item.data.opNote;
                if (item.data.assistFile) row["Asistans Dosya No"] = item.data.assistFile;
                if (item.data.damageFile) row["Hasar Dosya No"] = item.data.damageFile;
                if (item.data.location) row["Lokasyon / Şehir"] = item.data.location;

                // Handle Opinions horizontally
                if (Array.isArray(item.data.opinionRequests)) {
                    item.data.opinionRequests.forEach((req, idx) => {
                        const opHeader = `Görüş ${idx + 1}`;
                        let cellContent = `${req.targetDept} : Talep Edildi (${req.date})`;
                        if (req.status === 'Cevaplandı' || req.status === 'Görüş Verildi') {
                            cellContent = `${req.targetDept} : ${req.reply?.note || 'Verildi'} (${req.reply?.date || ''})`;
                        } else if (req.status === 'İptal Edildi') {
                            cellContent = `${req.targetDept} : İptal Edildi`;
                        }
                        row[opHeader] = cellContent;
                    });
                }
            }

            // 3. Status/Conclusion specifically requested
            const isResolved = item.status === 'Şikayet Sonuçlandı' || item.status === 'Dosya Sonuçlandı';
            row["Sorumlu Departman"] = isResolved ? (item.data?.conclusion?.department || '') : '';
            row["Haklı/Haksız Bilgisi"] = isResolved ? (item.data?.conclusion?.verdict || '') : '';

            rows.push(row);
        });

        // Use SheetJS to convert array to sheet
        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Şikayet Data");
        
        // 4. Capture Matrix/Tables from Reports if active
        const reportsView = document.getElementById('reports-view');
        if (reportsView && reportsView.classList.contains('active')) {
            const matrixElements = document.querySelectorAll('#reports-view .matrix-card table, #reports-view .list-card table, #reports-view .list-card .pagination-container');
            
            // Build a synthetic HTML table extracting raw matrix data
            if (matrixElements.length > 0) {
                let reportWsData = [];
                
                // 1. Olay/Açılış/Sorumlu Data Matrix Map
                const mapCityList = document.getElementById('map-city-list');
                const mapRegionList = document.getElementById('map-region-list');
                const providerList = document.getElementById('rep-provider-table-list');
                const authorList = document.getElementById('rep-author-table-list');
                
                let pushBlock = (title, element) => {
                     if (!element) return;
                     reportWsData.push([title]);
                     // Extract mini lists
                     let items = element.querySelectorAll('div > div:first-child');
                     items.forEach(it => {
                         let name = it.querySelector('span:first-child')?.textContent?.trim() || '';
                         let val = it.querySelector('span:last-child')?.textContent?.trim() || '';
                         if (name && val) reportWsData.push([name.replace(/^\d+/, '').trim(), val.replace(/\D/g, '')]);
                     });
                     reportWsData.push([]); // empty row
                };
                
                pushBlock('En Çok Şikayet Alan İller', mapCityList);
                pushBlock('Bölgelere Göre Dağılım', mapRegionList);
                pushBlock('Tedarikçi Dağılımı', providerList);
                pushBlock('Şikayet Açan Kişiler', authorList);

                if (reportWsData.length > 0) {
                     const reportWs = XLSX.utils.aoa_to_sheet(reportWsData);
                     XLSX.utils.book_append_sheet(workbook, reportWs, "Matrix Raporu");
                }
            }
        }

        XLSX.writeFile(workbook, "Eurocross Çözüm Merkezi Çıktıları.xlsx");
    }

    const exportBtns = document.querySelectorAll('.export-excel-btn');
    exportBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const type = btn.getAttribute('data-export-type');
            
            // Handle Matrix Excel Export
            if (type === 'matrixReport') {
                const workbook = XLSX.utils.book_new();
                
                // Scrape explicitly all .data-table items within report-view
                const reportsView = document.getElementById('reports-view');
                if (reportsView && reportsView.classList.contains('active')) {
                    const tables = reportsView.querySelectorAll('.data-table');
                    let wsData = [];
                    
                    tables.forEach(table => {
                        const titleEl = table.previousElementSibling;
                        if (titleEl && titleEl.tagName === 'H3') {
                            wsData.push([titleEl.textContent.trim()]);
                        } else {
                            wsData.push(["Tablo Verisi"]);
                        }
                        
                        const rows = table.querySelectorAll('tr');
                        rows.forEach(row => {
                            let rowData = [];
                            const cells = row.querySelectorAll('th, td');
                            cells.forEach(cell => rowData.push(cell.textContent.trim()));
                            wsData.push(rowData);
                        });
                        
                        wsData.push([]); // Empty row as spacer
                    });
                    
                    // Add mini lists as well
                    const mapCityList = document.getElementById('map-city-list');
                    const mapRegionList = document.getElementById('map-region-list');
                    const providerList = document.getElementById('rep-provider-table-list');
                    const authorList = document.getElementById('rep-author-table-list');
                    
                    let pushBlock = (title, element) => {
                         if (!element) return;
                         wsData.push([title]);
                         let items = element.querySelectorAll('div > div:first-child');
                         items.forEach(it => {
                             let name = it.querySelector('span:first-child')?.textContent?.trim() || '';
                             let val = it.querySelector('span:last-child')?.textContent?.trim() || '';
                             if (name && val) wsData.push([name.replace(/^\d+/, '').trim(), val.replace(/\D/g, '')]);
                         });
                         wsData.push([]); 
                    };
                    
                    pushBlock('En Çok Şikayet Alan İller', mapCityList);
                    pushBlock('Bölgelere Göre Dağılım', mapRegionList);
                    pushBlock('Tedarikçi Dağılımı', providerList);
                    pushBlock('Şikayet Açan Kişiler', authorList);

                    if (wsData.length > 0) {
                         const ws = XLSX.utils.aoa_to_sheet(wsData);
                         XLSX.utils.book_append_sheet(workbook, ws, "Matrix Raporları");
                         XLSX.writeFile(workbook, "Eurocross Çözüm Merkezi - Matris Raporları.xlsx");
                    } else {
                        showNotif('Dışa aktarılacak matris verisi bulunamadı.', 'warning');
                    }
                } else {
                    showNotif('Lütfen raporların yüklenmesini bekleyin.', 'warning');
                }
                return;
            }

            // Normal Data Export Function
            if (window.currentFilteredData && window.currentFilteredData[type]) {
                const data = window.currentFilteredData[type];
                if (data.length === 0) {
                    showNotif('Dışa aktarılacak kayıt bulunamadı.', 'warning');
                    return;
                }
                
                exportToExcel(data, type);
            }
        });
    });

    // --- REPORTING MODULE ---
    let reportCharts = {};

    function renderReports() {
        try {
            if (typeof Chart === 'undefined') {
                alert("Uyarı: Chart.js kütüphanesi yüklenemedi. İnternet bağlantınızı kontrol edin.");
            }

            if (!globalUser || (!globalUser.isAdmin && !globalUser.isAuthority && !globalUser.isClient)) return;

            // Dynamically setup type filter based on mode
            const typeFilterEl = document.getElementById('filter-rep-type');
            if (typeFilterEl) {
                if (window.currentReportType === 'external') {
                    if (globalUser.isClient) {
                         typeFilterEl.style.display = 'inline-block';
                         typeFilterEl.innerHTML = '<option value="">Tüm Şikayet Türleri</option><option value="İç Müşteri Hizmet Şikayeti">Hizmet Şikayeti</option><option value="İç Müşteri Çağrı Şikayeti">Çağrı Şikayeti</option>';
                    } else {
                         typeFilterEl.style.display = 'none';
                         typeFilterEl.value = '';
                    }
                } else {
                    typeFilterEl.style.display = 'inline-block';
                    typeFilterEl.innerHTML = '<option value="">Tüm Şikayet Türleri</option><option value="Dış Müşteri Şikayeti">Dış Müşteri Şikayetleri</option><option value="İç Müşteri Hizmet Şikayeti">İç Müşteri Hizmet Şikayetleri</option><option value="İç Müşteri Çağrı Şikayetleri">İç Müşteri Çağrı Şikayetleri</option>';
                }
            }

            // Populate Filters from global data
            const typeFilter = typeFilterEl ? typeFilterEl.value : '';
            const deptFilterSelect = document.getElementById('filter-rep-dept');
            const deptFilter = deptFilterSelect.value;
            const statusFilter = document.getElementById('filter-rep-status');
            const yearFilter = document.getElementById('filter-rep-year').value;
            const monthFilter = document.getElementById('filter-rep-month').value;
            const customerFilter = document.getElementById('filter-rep-customer');
            const srvTypeFilter = document.getElementById('filter-rep-srvtype');
            const providerFilter = document.getElementById('filter-rep-provider');
            const verdictFilter = document.getElementById('filter-rep-verdict').value;

            if (globalUser.isAuthority && window.currentReportType === 'internal') {
                deptFilterSelect.style.display = 'inline-block';
            } else {
                deptFilterSelect.style.display = 'none';
            }

            // UI Display logic based on Report Type
            const reportsViewEl = document.getElementById('reports-view');
            if (globalUser.isClient) {
                reportsViewEl.classList.add('client-report-view');
            } else {
                reportsViewEl.classList.remove('client-report-view');
            }

            if (window.currentReportType === 'external') {
                if (globalUser.isClient) {
                    document.getElementById('filter-rep-customer').classList.add('hidden');
                } else {
                    document.getElementById('filter-rep-customer').classList.remove('hidden');
                }
                document.getElementById('filter-rep-srvtype').classList.remove('hidden');
                document.getElementById('filter-rep-provider').classList.remove('hidden');

                let respCard = document.getElementById('rep-responsible-complaints')?.parentElement;
                let resolveTimeCard = document.getElementById('rep-avg-resolve-time')?.parentElement;
                let opTimeCard = document.getElementById('rep-avg-opinion-time')?.parentElement;
                if (respCard) respCard.classList.add('hidden');
                if (resolveTimeCard) resolveTimeCard.classList.remove('hidden');
                if (opTimeCard) opTimeCard.classList.add('hidden');

                let wrpResp = document.getElementById('wrapper-monthly-responsible');
                let wrpCust = document.getElementById('wrapper-customer-pie');
                let wrpProv = document.getElementById('wrapper-provider-bar');
                let wrpOpTime = document.getElementById('wrapper-monthly-opinion-time');
                let wrpTypeSrv = document.getElementById('chart-wrapper-srvtype');
                let wrpAuthor = document.getElementById('wrapper-author-table');
                let wrpMatrixResp = document.getElementById('wrapper-matrix-responsible');
                let wrpMatrixCust = document.getElementById('wrapper-matrix-customer');
                let wrpMatrixOpTime = document.getElementById('wrapper-matrix-opinion-time');

                if (wrpResp) wrpResp.classList.add('hidden');
                if (wrpCust) wrpCust.classList.add('hidden');
                if (wrpProv) wrpProv.classList.add('hidden');
                if (wrpOpTime) wrpOpTime.classList.add('hidden');
                if (wrpTypeSrv) wrpTypeSrv.classList.remove('hidden');
                if (wrpAuthor) wrpAuthor.classList.add('hidden');
                if (wrpMatrixResp) wrpMatrixResp.classList.add('hidden');
                if (wrpMatrixCust) wrpMatrixCust.classList.add('hidden');
                if (wrpMatrixOpTime) wrpMatrixOpTime.classList.add('hidden');
            } else {
                document.getElementById('filter-rep-customer').classList.remove('hidden');
                document.getElementById('filter-rep-srvtype').classList.remove('hidden');
                document.getElementById('filter-rep-provider').classList.remove('hidden');

                let respCard = document.getElementById('rep-responsible-complaints')?.parentElement;
                let resolveTimeCard = document.getElementById('rep-avg-resolve-time')?.parentElement;
                let opTimeCard = document.getElementById('rep-avg-opinion-time')?.parentElement;
                if (respCard) respCard.classList.remove('hidden');
                if (resolveTimeCard) resolveTimeCard.classList.remove('hidden');
                if (opTimeCard) opTimeCard.classList.remove('hidden');

                let wrpResp = document.getElementById('wrapper-monthly-responsible');
                let wrpCust = document.getElementById('wrapper-customer-pie');
                let wrpProv = document.getElementById('wrapper-provider-bar');
                let wrpOpTime = document.getElementById('wrapper-monthly-opinion-time');
                let wrpTypeSrv = document.getElementById('chart-wrapper-srvtype');
                let wrpAuthor = document.getElementById('wrapper-author-table');
                let wrpMatrixResp = document.getElementById('wrapper-matrix-responsible');
                let wrpMatrixCust = document.getElementById('wrapper-matrix-customer');
                let wrpMatrixOpTime = document.getElementById('wrapper-matrix-opinion-time');

                if (wrpResp) wrpResp.classList.remove('hidden');
                if (wrpCust) wrpCust.classList.remove('hidden');
                if (wrpProv) wrpProv.classList.remove('hidden');
                if (wrpOpTime) wrpOpTime.classList.remove('hidden');
                if (wrpTypeSrv) wrpTypeSrv.classList.remove('hidden');
                if (wrpAuthor) wrpAuthor.classList.remove('hidden');
                if (wrpMatrixResp) wrpMatrixResp.classList.remove('hidden');
                if (wrpMatrixCust) wrpMatrixCust.classList.remove('hidden');
                if (wrpMatrixOpTime) wrpMatrixOpTime.classList.remove('hidden');
            }

            // Pre-fill dropdown options dynamically based on the report type dataset
            let statuses = new Set();
            let depts = new Set(['Medikal', 'Mali İşler', 'ADAC Operasyon', 'Anlaşmalı Kurumlar', 'Medikal Operasyon', 'İnsan Kaynakları ve İdari İşler', 'Teknik Operasyon']);
            let customers = new Set();
            let srvTypes = new Set();
            let providers = new Set();

            savedComplaints.forEach(c => {
                const isClientComplaint = c.source === 'client' || (c.data && c.data.policyNo);
                if (window.currentReportType === 'external' && !isClientComplaint) return;
                if (window.currentReportType === 'internal' && isClientComplaint) return;

                if (globalUser.isClient && String(c.data?.customer || '').trim() !== String(globalUser.companyName || '').trim()) return;

                if (c.status) statuses.add(c.status);
                if (c.data?.customer) customers.add(c.data.customer);
                if (c.data?.serviceType) srvTypes.add(c.data.serviceType);
                if (c.data?.provider) providers.add(c.data.provider);
            });

            if (statusFilter.getAttribute('data-loaded-type') !== window.currentReportType) {
                statusFilter.innerHTML = '<option value="">Tüm Statüler</option>';
                deptFilterSelect.innerHTML = '<option value="">Tüm Departmanlar</option>';
                customerFilter.innerHTML = '<option value="">Tüm Müşteriler</option>';
                srvTypeFilter.innerHTML = '<option value="">Tüm Hizmet Türleri</option>';
                providerFilter.innerHTML = '<option value="">Tüm Tedarikçiler</option>';

                Array.from(statuses).sort().forEach(s => {
                    let opt = document.createElement('option'); opt.value = s; opt.textContent = s; statusFilter.appendChild(opt);
                });
                Array.from(depts).sort().forEach(d => {
                    let opt = document.createElement('option'); opt.value = d; opt.textContent = d; deptFilterSelect.appendChild(opt);
                });
                Array.from(customers).sort().forEach(c => {
                    let opt = document.createElement('option'); opt.value = c; opt.textContent = c; customerFilter.appendChild(opt);
                });
                Array.from(srvTypes).sort().forEach(st => {
                    if(!st) return;
                    let opt = document.createElement('option'); opt.value = st; opt.textContent = st; srvTypeFilter.appendChild(opt);
                });
                Array.from(providers).sort().forEach(p => {
                    if(!p) return;
                    let opt = document.createElement('option'); opt.value = p; opt.textContent = p; providerFilter.appendChild(opt);
                });
                
                statusFilter.setAttribute('data-loaded-type', window.currentReportType);
            }

            // Apply Access Rules:
            // Authority sees ALL. Admin sees ONLY their department
            let dataset = savedComplaints || [];
            
            if (globalUser.isClient) {
                // Strictly segregate Client data
                dataset = dataset.filter(c => c.data && c.data.policyNo && String(c.data.customer || '').trim() === String(globalUser.companyName || '').trim());
            } else if (!globalUser.isAuthority) {
                dataset = dataset.filter(c => 
                    c.department === globalUser.department || 
                    (c.data?.conclusion?.department === globalUser.department) ||
                    (c.data?.opinionRequests || []).some(o => o.targetDept === globalUser.department)
                );
            }

            // Apply HTML Filters
            const sStatus = statusFilter.value;
            const sCustomer = customerFilter.value;
            const sSrvType = srvTypeFilter.value;
            const sProvider = providerFilter.value;

            let filtered = dataset.filter(c => {
                let pass = true;
                
                const isClientComplaint = c.source === 'client' || (c.data && c.data.policyNo);

                // Core Split Logic
                if (window.currentReportType === 'internal' && isClientComplaint) pass = false;
                if (window.currentReportType === 'external' && !isClientComplaint) pass = false;

                if (typeFilter) {
                    if (globalUser.isClient) {
                         if (typeFilter === 'İç Müşteri Hizmet Şikayeti' && c.type !== 'Hizmet Şikayeti') pass = false;
                         if (typeFilter === 'İç Müşteri Çağrı Şikayeti' && c.type !== 'Çağrı Şikayeti') pass = false;
                    } else {
                         if (typeFilter === 'Dış Müşteri Şikayeti' && !isClientComplaint) pass = false;
                         if (typeFilter === 'İç Müşteri Hizmet Şikayeti' && (c.type !== 'Hizmet Şikayeti' || isClientComplaint)) pass = false;
                         if (typeFilter === 'İç Müşteri Çağrı Şikayeti' && (c.type !== 'Çağrı Şikayeti' || isClientComplaint)) pass = false;
                    }
                }
                
                if (sStatus && c.status !== sStatus) pass = false;
                if (sCustomer && c.data?.customer !== sCustomer) pass = false;
                
                if (globalUser.isAuthority && deptFilter) {
                    if (c.department !== deptFilter && c.data?.conclusion?.department !== deptFilter) pass = false;
                }
                
                // Strict Creation Date logic (Şikayet Tarihi) for filters
                let dateStr = c.date || c.data?.caseDate || ''; 
                let dYear = null;
                let dMonth = null;
                
                let parts = dateStr.split(/[\.\-\/]/);
                if (parts.length >= 3) {
                    dYear = parts[0].length === 4 ? parts[0] : parts[2];
                    dMonth = parts[1].padStart(2, '0');
                }
                
                if (dYear && dYear.length === 2) dYear = '20' + dYear;
                
                if (yearFilter && dYear !== yearFilter) pass = false;
                if (monthFilter && dMonth !== monthFilter) pass = false;

                if (c.type === 'Hizmet Şikayeti' && c.source !== 'client') {
                    if (sSrvType && c.data?.serviceType !== sSrvType) pass = false;
                    if (sProvider && c.data?.provider !== sProvider) pass = false;
                } else if (typeFilter === 'İç Müşteri Çağrı Şikayeti') {
                    // If Call complaint selected, these fields shouldn't filter them out unless technically selected previously.
                    if (sSrvType || sProvider) pass = false; 
                }

                if (verdictFilter) {
                    if (!c.data?.conclusion || c.data.conclusion.verdict !== verdictFilter) pass = false;
                }

                return pass;
            });

            // Hide/Show Service specific charts based on Call filter
            const chartWrapperSrvType = document.getElementById('chart-wrapper-srvtype');
            if (typeFilter === 'İç Müşteri Çağrı Şikayeti' && chartWrapperSrvType) {
                chartWrapperSrvType.style.display = 'none';
            } else if(chartWrapperSrvType) {
                chartWrapperSrvType.style.display = 'block';
            }

            // --- CALCULATIONS ---
            const totalCount = filtered.length;
            const openCount = filtered.filter(c => c.status === 'Talep Açıldı').length;
            const processCount = filtered.filter(c => c.status !== 'Şikayet Sonuçlandı' && c.status !== 'Dosya Sonuçlandı' && c.status !== 'Talep Açıldı').length;
            const resolvedCount = filtered.filter(c => c.status === 'Şikayet Sonuçlandı' || c.status === 'Dosya Sonuçlandı').length;
            let totalConcludedCases = 0; // For percentage denominator
            let justifiedCount = 0;
            let unjustifiedCount = 0;
            
            let resolveTimesInMs = [];
            let opinionTimesInMs = [];
            let responseTimesInMs = []; // Şikayeti Karşılama

            // Aggregation Arrays for Charts
            let monthlyOpened = [0,0,0,0,0,0,0,0,0,0,0,0];
            let monthlyResponsible = [0,0,0,0,0,0,0,0,0,0,0,0];
            let monthlyResolveTimes = Array.from({length: 12}, () => []);
            let monthlyOpinionTimes = Array.from({length: 12}, () => []);
            let monthlyClosers = Array.from({length: 12}, () => ({})); // { 'Ocak': { 'Ahmet': 5, 'Mehmet': 2 } }
            
            let monthlyCloserResponseMs = Array.from({length: 12}, () => ({})); // { 'Ocak': { 'Ahmet': [ms1, ms2] } }
            
            let monthlyDeptOpened = Array.from({length: 12}, () => ({}));
            let monthlyDeptResponsible = Array.from({length: 12}, () => ({}));
            
            // Phase 4 New Matrices
            let monthlyDeptResolveMs = Array.from({length: 12}, () => ({}));
            let monthlyDeptOpinionMs = Array.from({length: 12}, () => ({}));
            let monthlyCustomer = Array.from({length: 12}, () => ({}));
            let monthlyType = Array.from({length: 12}, () => ({}));
            let monthlyReason = Array.from({length: 12}, () => ({}));
            let monthlySrvType = Array.from({length: 12}, () => ({}));
            
            let customerDist = {};
            let typeDist = { 'Hizmet Şikayeti': 0, 'Çağrı Şikayeti': 0 };
            let srvTypeDist = {};
            let providerDist = {};
            let locationDist = {};
            let reasonDist = {};
            let authorDist = {}; // Şikayet Açan Kişiler
            
            // Phase 11.1 Array structures
            let dayDist = { 'Pazartesi': 0, 'Salı': 0, 'Çarşamba': 0, 'Perşembe': 0, 'Cuma': 0, 'Cumartesi': 0, 'Pazar': 0 };
            let hourDist = { '00:00-02:00': 0, '02:00-04:00': 0, '04:00-06:00': 0, '06:00-08:00': 0, '08:00-10:00': 0, '10:00-12:00': 0, '12:00-14:00': 0, '14:00-16:00': 0, '16:00-18:00': 0, '18:00-20:00': 0, '20:00-22:00': 0, '22:00-24:00': 0 };
            
            let monthlyDay = Array.from({length: 12}, () => ({ 'Pazartesi':0, 'Salı':0, 'Çarşamba':0, 'Perşembe':0, 'Cuma':0, 'Cumartesi':0, 'Pazar':0 }));
            let monthlyHour = Array.from({length: 12}, () => ({ '00:00-02:00':0, '02:00-04:00':0, '04:00-06:00':0, '06:00-08:00':0, '08:00-10:00':0, '10:00-12:00':0, '12:00-14:00':0, '14:00-16:00':0, '16:00-18:00':0, '18:00-20:00':0, '20:00-22:00':0, '22:00-24:00':0 }));

            let parseLogTime = (logDateStr) => {
                try {
                    let p = logDateStr.split(' ');
                    let dP = p[0].split('.');
                    let hP = p[1] ? p[1].split(':') : ['00','00'];
                    return new Date(`${dP[2]}-${dP[1]}-${dP[0]}T${hP[0]}:${hP[1]}:00`).getTime();
                } catch(e) { return null; }
            };

            filtered.forEach(c => {
                // Trend logic: Strict Creation Dates
                let dateStr = c.date || c.data?.caseDate || '';
                let dMonth = null;
                let cTimeMs = null;
                
                // Parse Date robustly for both legacy Date(..) and string DD.MM.YYYY HH:mm
                if (typeof dateStr === 'string' && dateStr.startsWith('Date(')) {
                    const mMatch = dateStr.match(/\d+/g);
                    if (mMatch && mMatch.length >= 3) {
                        dMonth = String(parseInt(mMatch[1]) + 1).padStart(2, '0');
                        cTimeMs = new Date(mMatch[0], mMatch[1], mMatch[2], mMatch[3]||0, mMatch[4]||0).getTime();
                    }
                } else if (dateStr) {
                    let parts = dateStr.split(/[\.\-\/]/);
                    if (parts.length >= 3) {
                        dMonth = parts[1].padStart(2, '0');
                        cTimeMs = parseLogTime(dateStr);
                    }
                }
                
                if (cTimeMs) {
                    let dObj = new Date(cTimeMs);
                    let daysTr = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
                    let dName = daysTr[dObj.getDay()];
                    
                    let h = dObj.getHours();
                    let hBin = Math.floor(h / 2) * 2;
                    let hStr = `${String(hBin).padStart(2, '0')}:00-${String(hBin + 2).padStart(2, '0')}:00`;
                    if (hBin === 22) hStr = '22:00-24:00';
                    
                    if (dayDist[dName] !== undefined) dayDist[dName]++;
                    if (hourDist[hStr] !== undefined) hourDist[hStr]++;
                    
                    // Month Aggregation
                    if (dMonth) {
                        let mIdx = parseInt(dMonth, 10) - 1;
                        if (mIdx >= 0 && mIdx <= 11) {
                            if (monthlyDay[mIdx] && monthlyDay[mIdx][dName] !== undefined) monthlyDay[mIdx][dName]++;
                            if (monthlyHour[mIdx] && monthlyHour[mIdx][hStr] !== undefined) monthlyHour[mIdx][hStr]++;
                        }
                    }
                }
                
                if (dMonth) {
                    let mIdx = parseInt(dMonth, 10) - 1;
                    if (mIdx >= 0 && mIdx <= 11) {
                        monthlyOpened[mIdx]++;
                        
                        let deptKey = (window.currentReportType === 'external') 
                                        ? (c.data?.customer || 'Bilinmiyor') 
                                        : (c.department || 'Bilinmiyor');
                                        
                        monthlyDeptOpened[mIdx][deptKey] = (monthlyDeptOpened[mIdx][deptKey] || 0) + 1;
                    }
                }

                // Pies & Lists logic
                if (c.data?.customer) {
                    customerDist[c.data.customer] = (customerDist[c.data.customer] || 0) + 1;
                    if (dMonth) {
                        let mIdx = parseInt(dMonth, 10) - 1;
                        if (mIdx >= 0 && mIdx <= 11) monthlyCustomer[mIdx][c.data.customer] = (monthlyCustomer[mIdx][c.data.customer] || 0) + 1;
                    }
                }
                if (c.type) {
                    typeDist[c.type] = (typeDist[c.type] || 0) + 1;
                    if (dMonth) {
                        let mIdx = parseInt(dMonth, 10) - 1;
                        if (mIdx >= 0 && mIdx <= 11) monthlyType[mIdx][c.type] = (monthlyType[mIdx][c.type] || 0) + 1;
                    }
                }
                if (c.reason) {
                    reasonDist[c.reason] = (reasonDist[c.reason] || 0) + 1;
                    if (dMonth) {
                        let mIdx = parseInt(dMonth, 10) - 1;
                        if (mIdx >= 0 && mIdx <= 11) monthlyReason[mIdx][c.reason] = (monthlyReason[mIdx][c.reason] || 0) + 1;
                    }
                }
                
                let authName = String(c.author).trim();
                // Filter out system fallbacks for author
                if (authName && authName !== 'Sistem' && authName !== 'Bilinmiyor' && authName !== 'Gviz Müşterisi') {
                    authorDist[authName] = (authorDist[authName] || 0) + 1;
                }
                
                if (c.type !== 'Çağrı Şikayeti' || window.currentReportType === 'external') {
                    if (c.data?.serviceType) {
                        srvTypeDist[c.data.serviceType] = (srvTypeDist[c.data.serviceType] || 0) + 1;
                        if (dMonth) {
                            let mIdx = parseInt(dMonth, 10) - 1;
                            if (mIdx >= 0 && mIdx <= 11) monthlySrvType[mIdx][c.data.serviceType] = (monthlySrvType[mIdx][c.data.serviceType] || 0) + 1;
                        }
                    }
                    if (c.data?.provider) providerDist[c.data.provider] = (providerDist[c.data.provider] || 0) + 1;
                    if (c.data?.location) locationDist[c.data.location] = (locationDist[c.data.location] || 0) + 1;
                }

                // Conclusion logic based exclusively on Sonuçlanan dosyalar
                if (c.status === 'Şikayet Sonuçlandı') {
                    totalConcludedCases++;
                    if (c.data && c.data.conclusion) {
                        if (c.data.conclusion.verdict === 'Haklı') justifiedCount++;
                        if (c.data.conclusion.verdict === 'Haksız') unjustifiedCount++;
                    }
                }
                
                // Track Closers Trend based on who concluded it
                if (c.data && c.data.conclusion && c.status === 'Şikayet Sonuçlandı') {
                    let closerName = c.data.conclusion.by || 'Yetkili';
                    // We map the closure month based on the creation date of the complaint as per standard KPI, or the closure date if preferred. Using creation date `dMonth` to keep cohorts intact.
                    if (dMonth) {
                        let mIdx = parseInt(dMonth, 10) - 1;
                        if (mIdx >= 0 && mIdx <= 11) {
                            monthlyClosers[mIdx][closerName] = (monthlyClosers[mIdx][closerName] || 0) + 1;
                        }
                    }
                }

                // Sorumlu Tutulan Dosya Sayısı:
                // Only count if this file involves the logged-in user's department as the conclusion target OR if authority.
                if (c.data && c.data.conclusion) {
                    let cDept = c.data.conclusion.department || 'Bilinmiyor';
                    if (globalUser.isAuthority || cDept === globalUser.department) {
                        if (dMonth) {
                            let rIdx = parseInt(dMonth, 10) - 1;
                            if (rIdx >= 0 && rIdx <= 11) monthlyResponsible[rIdx]++;
                        }
                    }
                    if (dMonth) {
                        let rIdx = parseInt(dMonth, 10) - 1;
                        if (rIdx >= 0 && rIdx <= 11) {
                            monthlyDeptResponsible[rIdx][cDept] = (monthlyDeptResponsible[rIdx][cDept] || 0) + 1;
                        }
                    }
                }

                // Cumulative Resolve Time & Response Time
                if (c.logs && Array.isArray(c.logs)) {
                    let totalActiveMs = 0;
                    let lastOpenMs = cTimeMs;
                    let handledResponse = false;
                    
                    // Iterate chronologically
                    c.logs.forEach(log => {
                        let logTime = parseLogTime(log.date);
                        if (!logTime) return;
                        
                        // Fallback response time (First time taken)
                        if (log.action.includes('Şikayeti Al') && cTimeMs) {
                            // Only record the FIRST time it was taken
                            if (!handledResponse) {
                                let diff = logTime - cTimeMs;
                                if (diff >= 0) {
                                    responseTimesInMs.push(diff);
                                    let responder = log.user || 'Sistem Görevlisi';
                                    if (dMonth) {
                                        let mIdx = parseInt(dMonth, 10) - 1;
                                        if (mIdx >= 0 && mIdx <= 11) {
                                            if(!monthlyCloserResponseMs[mIdx][responder]) monthlyCloserResponseMs[mIdx][responder] = [];
                                            monthlyCloserResponseMs[mIdx][responder].push(diff);
                                        }
                                    }
                                }
                                handledResponse = true;
                            }
                        }

                        if (log.action.includes('Sonuçlandırı') || log.action.includes('Kapatıldı')) {
                            if (lastOpenMs) {
                                let activeDiff = logTime - lastOpenMs;
                                if (activeDiff >= 0) totalActiveMs += activeDiff;
                                lastOpenMs = null; // System is closed
                            }
                        } else if (log.action.includes('Yeniden Aç') || log.action.includes('Tekrar Aktif') || log.action.includes('İtiraz Edildi')) {
                            lastOpenMs = logTime; // System is open again
                        }
                    });

                    if (totalActiveMs > 0) {
                        resolveTimesInMs.push(totalActiveMs);
                        
                        let rdDept = (window.currentReportType === 'external') 
                                        ? (c.data?.customer || 'Bilinmiyor') 
                                        : (c.department || 'Bilinmiyor');
                                        
                        if (dMonth) {
                            let mIdx = parseInt(dMonth, 10) - 1;
                            if (mIdx >= 0 && mIdx <= 11) {
                                monthlyResolveTimes[mIdx].push(totalActiveMs);
                                if(!monthlyDeptResolveMs[mIdx][rdDept]) monthlyDeptResolveMs[mIdx][rdDept] = [];
                                monthlyDeptResolveMs[mIdx][rdDept].push(totalActiveMs);
                            }
                        }
                    }
                }

                // Opinion Times
                if (c.data?.opinionRequests) {
                    c.data.opinionRequests.forEach(req => {
                        // Only count opinions you were asked to give or if you're an authority
                        if (globalUser.isAuthority || req.targetDept === globalUser.department) {
                            if (req.status === 'Cevaplandı' && req.reply && req.date && req.reply.date) {
                                let reqTime = parseLogTime(req.date);
                                let repTime = parseLogTime(req.reply.date);
                                if (reqTime && repTime) {
                                    let diff = repTime - reqTime;
                                    opinionTimesInMs.push(diff);
                                    
                                // Push to monthly trend
                                    let odDept = req.targetDept || 'Bilinmiyor';
                                    if (dMonth) {
                                        let mIdx = parseInt(dMonth, 10) - 1;
                                        if (mIdx >= 0 && mIdx <= 11) {
                                            monthlyOpinionTimes[mIdx].push(diff);
                                            if(!monthlyDeptOpinionMs[mIdx][odDept]) monthlyDeptOpinionMs[mIdx][odDept] = [];
                                            monthlyDeptOpinionMs[mIdx][odDept].push(diff);
                                        }
                                    }
                                }
                            }
                        }
                    });
                }
            });

            // Compute KPIs
            let justRate = totalConcludedCases > 0 ? ((justifiedCount / totalConcludedCases) * 100).toFixed(1) : 0;
            let unjustRate = totalConcludedCases > 0 ? ((unjustifiedCount / totalConcludedCases) * 100).toFixed(1) : 0;

            let numRes = globalUser.isAuthority ? monthlyResponsible.reduce((a,b)=>a+b,0) : filtered.filter(x => x.data && x.data.conclusion && x.data.conclusion.department === globalUser.department).length;

            function formatMsToHHMMSS(msArray) {
                if (!msArray || msArray.length === 0) return "00:00:00";
                let avgMs = msArray.reduce((acc, curr) => acc + curr, 0) / msArray.length;
                let totalSecs = Math.floor(avgMs / 1000);
                if (totalSecs < 0 || isNaN(totalSecs)) return "00:00:00";
                let hours = Math.floor(totalSecs / 3600);
                let minutes = Math.floor((totalSecs % 3600) / 60);
                let seconds = totalSecs % 60;
                return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
            }

            const trueTotalCount = deptFilter ? filtered.filter(x => x.department === deptFilter).length : totalCount;

            document.getElementById('rep-total-complaints').textContent = trueTotalCount;
            document.getElementById('rep-open-complaints').textContent = openCount;
            document.getElementById('rep-process-complaints').textContent = processCount;
            document.getElementById('rep-resolved-complaints').textContent = resolvedCount;
            
            document.getElementById('rep-responsible-complaints').textContent = numRes;
            
            // Haklı/Haksız are calculated over Concluded Cases only
            document.getElementById('rep-justified-rate').textContent = `${justifiedCount} Adet (%${justRate})`;
            document.getElementById('rep-unjustified-rate').textContent = `${unjustifiedCount} Adet (%${unjustRate})`;
            
            document.getElementById('rep-avg-resolve-time').textContent = formatMsToHHMMSS(resolveTimesInMs);
            document.getElementById('rep-avg-opinion-time').textContent = formatMsToHHMMSS(opinionTimesInMs);
            
            let avgResponseEl = document.getElementById('rep-avg-response-time');
            if (avgResponseEl) avgResponseEl.textContent = formatMsToHHMMSS(responseTimesInMs);

            // Matrix Rendering Helper
            const renderMatrix = (dataMatrix, tableId, dynamicHeader = null) => {
                let tbody = document.querySelector(`#${tableId} tbody`);
                if (!tbody) return;
                tbody.innerHTML = '';
                
                let th = document.querySelector(`#${tableId} th`);
                if(th) {
                    if(dynamicHeader && window.currentReportType === 'external') {
                        th.textContent = 'Müşteri Adı';
                    } else if (dynamicHeader) {
                        th.textContent = 'Departman';
                    }
                }
                
                // Get all unique departments from the matrix
                let allDepts = new Set();
                dataMatrix.forEach(monthMap => {
                    Object.keys(monthMap).forEach(k => allDepts.add(k));
                });
                
                let deptsArray = Array.from(allDepts).sort();
                if(deptsArray.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="13" style="text-align:center;">Kayıt bulunamadı.</td></tr>';
                    return;
                }
                
                deptsArray.forEach(dept => {
                    let tr = document.createElement('tr');
                    let html = `<td style="text-align:left; font-weight:600;">${dept}</td>`;
                    let rowTotal = 0;
                    for(let i=0; i<12; i++) {
                        let val = dataMatrix[i][dept] || 0;
                        rowTotal += val;
                        html += `<td>${val > 0 ? val : '-'}</td>`;
                    }
                    html += `<td style="font-weight:bold; color:var(--primary-dark);">${rowTotal > 0 ? rowTotal : '-'}</td>`;
                    tr.innerHTML = html;
                    tbody.appendChild(tr);
                });
            };
            
            // Special Matrix for Times
            const renderTimeMatrix = (dataMatrix, tableId, dynamicHeader = null) => {
                let tbody = document.querySelector(`#${tableId} tbody`);
                if (!tbody) return;
                tbody.innerHTML = '';
                
                let th = document.querySelector(`#${tableId} th`);
                if(th) {
                    if(dynamicHeader && window.currentReportType === 'external') {
                        th.textContent = 'Müşteri Adı';
                    } else if (dynamicHeader) {
                        th.textContent = 'Departman';
                    }
                }

                let allDepts = new Set();
                dataMatrix.forEach(monthMap => { Object.keys(monthMap).forEach(k => allDepts.add(k)); });
                
                let deptsArray = Array.from(allDepts).sort();
                if(deptsArray.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="13" style="text-align:center;">Kayıt bulunamadı.</td></tr>';
                    return;
                }
                
                deptsArray.forEach(dept => {
                    let tr = document.createElement('tr');
                    let html = `<td style="text-align:left; font-weight:600;">${dept}</td>`;
                    let allMs = [];
                    for(let i=0; i<12; i++) {
                        let msArray = dataMatrix[i][dept] || [];
                        allMs = allMs.concat(msArray);
                        let fTime = formatMsToHHMMSS(msArray);
                        html += `<td>${fTime !== '00:00:00' ? fTime : '-'}</td>`;
                    }
                    let totalTime = formatMsToHHMMSS(allMs);
                    html += `<td style="font-weight:bold; color:var(--primary-dark);">${totalTime !== '00:00:00' ? totalTime : '-'}</td>`;
                    tr.innerHTML = html;
                    tbody.appendChild(tr);
                });
            };

            renderMatrix(monthlyDeptOpened, 'matrix-opened-table', true);
            renderMatrix(monthlyDeptResponsible, 'matrix-responsible-table', false); // Responsible isn't shown externally anyway
            
            // Rename visual Matrix DOM Headings dynamically:
            let mapWrpTitleOpened = document.querySelector('#wrapper-matrix-opened h3');
            if(mapWrpTitleOpened) mapWrpTitleOpened.textContent = window.currentReportType === 'external' ? 'Müşteri Bazlı Açılan Şikayet Sayıları' : 'Departman Bazlı Açılan Şikayet Sayıları';
            
            let mapWrpTitleResolve = document.querySelector('#wrapper-matrix-resolve-time h3');
            if(mapWrpTitleResolve) mapWrpTitleResolve.textContent = window.currentReportType === 'external' ? 'Müşteri Bazlı Aylık Ort. Çözüm Süresi' : 'Departman Bazlı Aylık Ort. Çözüm Süresi';

            // Phase 4 Matrix Injections
            renderTimeMatrix(monthlyDeptResolveMs, 'matrix-resolve-table', true);
            renderTimeMatrix(monthlyDeptOpinionMs, 'matrix-opinion-table', false);
            renderMatrix(monthlyCustomer, 'matrix-customer-table');
            renderMatrix(monthlyType, 'matrix-type-table');
            renderMatrix(monthlyReason, 'matrix-reason-table');
            renderMatrix(monthlySrvType, 'matrix-srvtype-table');
            
            // Phase 4b Closer Matrices
            renderMatrix(monthlyClosers, 'matrix-closer-table');
            renderTimeMatrix(monthlyCloserResponseMs, 'matrix-response-table');

            // --- CHART RENDERING HELPER ---
            if (typeof ChartDataLabels !== 'undefined') Chart.register(ChartDataLabels);

            function renderChart(id, type, labels, data, bgColor, options = {}) {
                if (typeof Chart === 'undefined') return;
                const ctx = document.getElementById(id);
                if (!ctx) return;
                if (reportCharts[id]) reportCharts[id].destroy();

                let datasets = [];
                // Handle multiple datasets (for the new Line Chart of Closers)
                if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && !Array.isArray(data[0])) {
                    datasets = data;
                } else {
                    datasets = [{
                        label: 'Adet',
                        data: data,
                        backgroundColor: bgColor,
                        borderColor: Array.isArray(bgColor) ? bgColor.map(c => c.replace('0.7', '1')) : (typeof bgColor === 'string' ? bgColor.replace('0.7', '1') : bgColor),
                        borderWidth: 2,
                        fill: type === 'line' ? false : true,
                        tension: 0.3
                    }];
                }

                let plugins = {};
                
                // Add explicit sizing for pie/doughnut to let labels breathe
                if (type === 'pie' || type === 'doughnut') {
                    options.radius = '70%'; 
                    options.cutout = type === 'doughnut' ? '60%' : undefined;
                }

                if (typeof ChartDataLabels !== 'undefined') {
                    plugins.datalabels = {
                        color: type === 'line' || type === 'bar' ? 'transparent' : '#000000',
                        font: { weight: 'normal', size: 12, family: "'Calibri', 'Arial', sans-serif" },
                        anchor: (context) => (type === 'pie' || type === 'doughnut') ? 'end' : 'center',
                        align: (context) => (type === 'pie' || type === 'doughnut') ? 'end' : 'center',
                        offset: (context) => (type === 'pie' || type === 'doughnut') ? 35 : 5,
                        formatter: (value, context) => {
                            if (type === 'line' || type === 'bar') return ''; 
                            if (type === 'pie' || type === 'doughnut') {
                                let sum = context.chart._metasets[context.datasetIndex].total;
                                if (sum === 0) return '';
                                let percentage = (value * 100 / sum).toFixed(1) + "%";
                                return percentage;
                            }
                            return value > 0 ? value : '';
                        }
                    };
                }

                // Disabling Background Gridlines
                let mergedScales = options.scales || {};
                if (type !== 'pie' && type !== 'doughnut') {
                    mergedScales = {
                        x: {
                            grid: { display: false, drawBorder: false },
                            ticks: { color: '#000000', font: { family: "'Calibri', 'Arial', sans-serif" } },
                            ...(options.scales?.x || {})
                        },
                        y: {
                            grid: { display: false, drawBorder: false },
                            ticks: { color: '#000000', beginAtZero: true, font: { family: "'Calibri', 'Arial', sans-serif" } },
                            ...(options.scales?.y || {})
                        }
                    };
                }

                reportCharts[id] = new Chart(ctx.getContext('2d'), {
                    type: type,
                    data: {
                        labels: labels,
                        datasets: datasets
                    },
                    options: { 
                        ...options, 
                        scales: type !== 'pie' && type !== 'doughnut' ? mergedScales : undefined,
                        responsive: true, 
                        maintainAspectRatio: false,
                        layout: { padding: (type === 'pie' || type === 'doughnut') ? 20 : 0 },
                        plugins: { 
                            ...plugins, 
                            ...options.plugins,
                            legend: {
                                labels: { color: '#000000', font: { weight: 'normal', family: "'Calibri', 'Arial', sans-serif" } },
                                onClick: (type === 'pie' || type === 'doughnut') ? null : Chart.defaults.plugins.legend.onClick,
                                ...(options.plugins && options.plugins.legend ? options.plugins.legend : {})
                            }
                        }
                    }
                });
            }

            const monthLabels = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
            const sharedColors = ["#E76F2E", "#FFC570", "#EFD2B0", "#547792", "#F2D479", "#D2C4B4", "#E8F5BD", "#FFF4EA", "#FFCE99"];

            renderChart('chart-monthly-opened', 'line', monthLabels, monthlyOpened, '#e69407');
            if(!globalUser.isClient) {
                renderChart('chart-monthly-responsible', 'line', monthLabels, monthlyResponsible, '#2980b9');
            }

            // Averages for the new Line Charts
            let avgResolveLine = monthlyResolveTimes.map(arr => arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length)/3600000 : 0).map(v => parseFloat(v.toFixed(1)));
            let avgOpinionLine = monthlyOpinionTimes.map(arr => arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length)/3600000 : 0).map(v => parseFloat(v.toFixed(1)));
            
            renderChart('chart-monthly-resolve-time', 'line', monthLabels, avgResolveLine, '#27ae60');
            if(!globalUser.isClient) {
                renderChart('chart-monthly-opinion-time', 'line', monthLabels, avgOpinionLine, '#e74c3c');
            }
            
            // Closer Performance Multi-Line Chart
                let uniqueClosers = new Set();
                monthlyClosers.forEach(mObj => Object.keys(mObj).forEach(k => uniqueClosers.add(k)));
                
                let lineDatasets = [];
                let colorIndex = 0;
                uniqueClosers.forEach(closer => {
                    let cData = [];
                    for(let i=0; i<12; i++) { cData.push(monthlyClosers[i][closer] || 0); }
                    lineDatasets.push({
                        label: closer,
                        data: cData,
                        borderColor: sharedColors[colorIndex % sharedColors.length],
                        backgroundColor: sharedColors[colorIndex % sharedColors.length],
                        borderWidth: 2,
                        fill: false,
                        tension: 0.3
                    });
                    colorIndex++;
                });
                renderChart('chart-monthly-closer', 'line', monthLabels, lineDatasets, null, {
                    plugins: { legend: { display: true, position: 'bottom' } }
                });

                // Phase 4b Response Time Multi-Line Chart
                let uniqueResponders = new Set();
                monthlyCloserResponseMs.forEach(mObj => Object.keys(mObj).forEach(k => uniqueResponders.add(k)));
                
                let respDatasets = [];
                let rColorIdx = 0;
                uniqueResponders.forEach(resp => {
                    let rData = [];
                    for(let i=0; i<12; i++) { 
                        let arr = monthlyCloserResponseMs[i][resp] || [];
                        let avgHour = arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length)/3600000 : 0;
                        rData.push(parseFloat(avgHour.toFixed(2))); 
                    }
                    respDatasets.push({
                        label: resp,
                        data: rData,
                        borderColor: sharedColors[rColorIdx % sharedColors.length],
                        backgroundColor: sharedColors[rColorIdx % sharedColors.length],
                        borderWidth: 2,
                        fill: false,
                        tension: 0.3
                    });
                    rColorIdx++;
                });
                renderChart('chart-monthly-response-time', 'line', monthLabels, respDatasets, null, {
                    plugins: { legend: { display: true, position: 'bottom' } }
                });

            if(!globalUser.isClient) {
                renderChart('chart-customer-pie', 'doughnut', Object.keys(customerDist), Object.values(customerDist), sharedColors);
            }
            renderChart('chart-type-pie', 'pie', Object.keys(typeDist), Object.values(typeDist), sharedColors);
            renderChart('chart-reason-pie', 'pie', Object.keys(reasonDist), Object.values(reasonDist), sharedColors);
            
            // Phase 11: Day & Hour Trend Charts
            renderChart('chart-trend-day', 'bar', Object.keys(dayDist), Object.values(dayDist), '#547792', {
                indexAxis: 'y',
                plugins: { legend: { display: false } }
            });
            renderChart('chart-trend-hour', 'line', Object.keys(hourDist), Object.values(hourDist), '#E76F2E', {
                plugins: { legend: { display: false } },
                tension: 0.3,
                fill: true,
                backgroundColor: 'rgba(231, 111, 46, 0.2)'
            });
            
            // Populate Matrix Day (12 Months)
            const mDayTbody = document.querySelector('#matrix-day-table tbody');
            if (mDayTbody) {
                mDayTbody.innerHTML = '';
                let totalRow = Array(12).fill(0);
                let superTotalDay = 0;
                
                Object.keys(dayDist).forEach(k => {
                    let rowHtml = `<tr><td>${k}</td>`;
                    let rowSum = 0;
                    for (let i = 0; i < 12; i++) {
                        let val = monthlyDay[i][k] || 0;
                        rowSum += val;
                        totalRow[i] += val;
                        rowHtml += `<td>${val}</td>`;
                    }
                    superTotalDay += rowSum;
                    rowHtml += `<td style="font-weight:bold; color:var(--primary-dark);">${rowSum}</td></tr>`;
                    mDayTbody.innerHTML += rowHtml;
                });
                
                let footDay = `<tr style="font-weight:bold; background-color:#f8f9fa;"><td>Toplam</td>`;
                for (let i = 0; i < 12; i++) { footDay += `<td>${totalRow[i]}</td>`; }
                footDay += `<td style="color:var(--primary-dark);">${superTotalDay}</td></tr>`;
                mDayTbody.innerHTML += footDay;
            }
            
            // Populate Matrix Hour (12 Months)
            const mHourTbody = document.querySelector('#matrix-hour-table tbody');
            if (mHourTbody) {
                mHourTbody.innerHTML = '';
                let totalRow = Array(12).fill(0);
                let superTotalHour = 0;
                
                Object.keys(hourDist).forEach(k => {
                    let rowHtml = `<tr><td>${k}</td>`;
                    let rowSum = 0;
                    for (let i = 0; i < 12; i++) {
                        let val = monthlyHour[i][k] || 0;
                        rowSum += val;
                        totalRow[i] += val;
                        rowHtml += `<td>${val}</td>`;
                    }
                    superTotalHour += rowSum;
                    rowHtml += `<td style="font-weight:bold; color:var(--primary-dark);">${rowSum}</td></tr>`;
                    mHourTbody.innerHTML += rowHtml;
                });
                
                let footHour = `<tr style="font-weight:bold; background-color:#f8f9fa;"><td>Toplam</td>`;
                for (let i = 0; i < 12; i++) { footHour += `<td>${totalRow[i]}</td>`; }
                footHour += `<td style="color:var(--primary-dark);">${superTotalHour}</td></tr>`;
                mHourTbody.innerHTML += footHour;
            }
            
            // --- LIST & PAGINATION RENDERING ---
            const renderPaginatedList = (dataList, containerId, paginationId, titleKey, valueSuffix) => {
                const container = document.getElementById(containerId);
                const pager = document.getElementById(paginationId);
                if (!container || !pager) return;
                
                container.innerHTML = '';
                pager.innerHTML = '';
                
                if (dataList.length === 0) {
                    container.innerHTML = '<div style="padding:10px; color:var(--text-muted); text-align:center;">Kayıt bulunamadı.</div>';
                    return;
                }
                
                const PAGE_SIZE = 10;
                let currentPage = 1;
                const totalPages = Math.ceil(dataList.length / PAGE_SIZE) || 1;
                
                const renderPage = (page) => {
                    container.innerHTML = '';
                    const paginated = dataList.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
                    paginated.forEach(([name, count], index) => {
                        let globalIndex = (page - 1) * PAGE_SIZE + index + 1;
                        let maxVal = Math.max(...dataList.map(item => item[1]));
                        let pct = maxVal > 0 ? (count / maxVal) * 100 : 0;
                        
                        let medal = '';
                        if (globalIndex === 1) medal = `<span style="display:inline-block; width: 24px; height: 24px; background: #f1c40f; color: white; border-radius: 50%; text-align: center; line-height: 24px; margin-right: 8px; font-size: 0.8rem;">1</span>`;
                        else if (globalIndex === 2) medal = `<span style="display:inline-block; width: 24px; height: 24px; background: #bdc3c7; color: white; border-radius: 50%; text-align: center; line-height: 24px; margin-right: 8px; font-size: 0.8rem;">2</span>`;
                        else if (globalIndex === 3) medal = `<span style="display:inline-block; width: 24px; height: 24px; background: #cd7f32; color: white; border-radius: 50%; text-align: center; line-height: 24px; margin-right: 8px; font-size: 0.8rem;">3</span>`;
                        else medal = `<span style="display:inline-block; width: 24px; height: 24px; background: #eee; color: #666; border-radius: 50%; text-align: center; line-height: 24px; margin-right: 8px; font-size: 0.8rem;">${globalIndex}</span>`;
                        
                        let div = document.createElement('div');
                        div.style.marginBottom = '12px';
                        div.innerHTML = `
                            <div style="display:flex; justify-content:space-between; margin-bottom:4px; align-items:center;">
                                <span style="font-weight:600; color:var(--text-dark); flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${name}">
                                    ${medal}${name}
                                </span>
                                <span style="font-weight:700; color:var(--primary-orange);">${count} ${valueSuffix}</span>
                            </div>
                            <div style="height:6px; background:var(--bg-light); border-radius:3px; overflow:hidden;">
                                <div style="height:100%; width:${pct}%; background:linear-gradient(90deg, var(--primary-orange), #ffb84d); border-radius:3px;"></div>
                            </div>
                        `;
                        container.appendChild(div);
                    });
                };

                const renderPagerButtons = () => {
                    pager.innerHTML = '';
                    for (let i = 1; i <= totalPages; i++) {
                        let btn = document.createElement('button');
                        btn.className = `pagination-btn ${i === currentPage ? 'active' : ''}`;
                        btn.style.cssText = i === currentPage 
                            ? "background: var(--primary-orange); color: white; border: none; border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 0.8rem;"
                            : "background: var(--bg-light); color: var(--text-dark); border: 1px solid rgba(0,0,0,0.1); border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 0.8rem;";
                        btn.textContent = i;
                        btn.onclick = () => {
                            currentPage = i;
                            renderPage(currentPage);
                            renderPagerButtons();
                        };
                        pager.appendChild(btn);
                    }
                };

                renderPage(currentPage);
                renderPagerButtons();
            };

            let authorSorted = Object.entries(authorDist).sort((a,b) => b[1] - a[1]);
            renderPaginatedList(authorSorted, 'rep-author-table-list', 'rep-author-pagination', 'Kişi', 'Dosya');

            let reqTypeStr = String(typeFilter).trim() || '';
            let hideProvider = (reqTypeStr === 'İç Müşteri Çağrı Şikayetleri' || reqTypeStr === 'Dış Müşteri Şikayetleri');
            let repProviderCont = document.getElementById('wrapper-provider-bar');
            
            if (hideProvider) {
                if (repProviderCont) repProviderCont.style.display = 'none';
            } else {
                if (repProviderCont) repProviderCont.style.display = 'block';
                let providerSorted = Object.entries(providerDist).sort((a,b) => b[1] - a[1]);
                renderPaginatedList(providerSorted, 'rep-provider-table-list', 'rep-provider-pagination', 'Tedarikçi', 'Kayıt');
            }

            // Setup Map and Lists for Location
            let locSorted = Object.entries(locationDist).sort((a,b) => b[1] - a[1]).slice(0, 10);
            if (Object.keys(locationDist).length > 0) {
                let cityHtml = '';
                locSorted.forEach(l => {
                    cityHtml += `<div style="display:flex; justify-content:space-between; padding:8px 10px; border-bottom:1px solid #eee;"><span>${l[0]}</span><span style="color:#e69407; font-weight:bold;">${l[1]}</span></div>`;
                });
                document.getElementById('map-city-list').innerHTML = cityHtml;

                let regionalMap = { 'Marmara':0, 'Ege':0, 'Akdeniz':0, 'İç Anadolu':0, 'Doğu Anadolu':0, 'Güneydoğu Anadolu':0, 'Karadeniz':0 };
                Object.entries(locationDist).forEach(([city, v]) => {
                     let cLower = (city || '').toLocaleLowerCase('tr-TR');
                     if (cLower.includes('istanbul') || cLower.includes('ist') || cLower.includes('bur') || cLower.includes('koc') || cLower.includes('tek') || cLower.includes('yal') || cLower.includes('sak') || cLower.includes('edi')) regionalMap['Marmara'] += v;
                     else if (cLower.includes('izmir') || cLower.includes('izm') || cLower.includes('man') || cLower.includes('ayd') || cLower.includes('den') || cLower.includes('muğ') || cLower.includes('mug')) regionalMap['Ege'] += v;
                     else if (cLower.includes('antalya') || cLower.includes('ant') || cLower.includes('mer') || cLower.includes('ada') || cLower.includes('hat') || cLower.includes('osm')) regionalMap['Akdeniz'] += v;
                     else if (cLower.includes('ankara') || cLower.includes('ank') || cLower.includes('kon') || cLower.includes('kay') || cLower.includes('esk') || cLower.includes('siv')) regionalMap['İç Anadolu'] += v;
                     else if (cLower.includes('trabzon') || cLower.includes('tra') || cLower.includes('sam') || cLower.includes('ord') || cLower.includes('riz') || cLower.includes('art')) regionalMap['Karadeniz'] += v;
                     else if (cLower.includes('diyarbakır') || cLower.includes('diy') || cLower.includes('gaz') || cLower.includes('şır') || cLower.includes('şan') || cLower.includes('mar') || cLower.includes('kah')) regionalMap['Güneydoğu Anadolu'] += v;
                     else if (cLower.includes('erzurum') || cLower.includes('erz') || cLower.includes('van') || cLower.includes('mal') || cLower.includes('ela')) regionalMap['Doğu Anadolu'] += v;
                     else regionalMap['Diğer'] = (regionalMap['Diğer'] || 0) + v;
                });
                
                let regHtml = '';
                Object.entries(regionalMap).filter(k => k[1]>0).sort((a,b)=>b[1]-a[1]).forEach(r => {
                    regHtml += `<div style="display:flex; justify-content:space-between; padding:8px 10px; border-bottom:1px solid #eee;"><span>${r[0]}</span><span style="color:#e69407; font-weight:bold;">${r[1]}</span></div>`;
                });
                document.getElementById('map-region-list').innerHTML = regHtml;

                if (typeof echarts !== 'undefined' && typeof turkeyGeoJson !== 'undefined') {
                    let mapChart = echarts.init(document.getElementById('chart-location-map'));
                    echarts.registerMap('turkey', turkeyGeoJson);
                    
                    let mapData = Object.keys(locationDist).map(k => ({
                        name: k.charAt(0).toLocaleUpperCase('tr-TR') + k.slice(1).toLocaleLowerCase('tr-TR'),
                        value: locationDist[k]
                    }));

                    mapChart.setOption({
                        tooltip: { trigger: 'item' },
                        visualMap: {
                            min: 0,
                            max: Math.max(...Object.values(locationDist), 1),
                            left: 'left',
                            top: 'bottom',
                            inRange: { color: ['#fff4e6', '#e69407'] },
                            show: false
                        },
                        series: [{
                            name: 'Şikayet Sayısı',
                            type: 'map',
                            map: 'turkey',
                            roam: false,
                            label: { show: false },
                            data: mapData
                        }]
                    });
                }
            }

            renderChart('chart-srvtype-pie', 'pie', Object.keys(srvTypeDist), Object.values(srvTypeDist), sharedColors);
            
        } catch (err) {
            alert("Raporlar yüklenirken lokal bir hata oluştu:\n" + err.message);
            console.error(err);
        }
    }

    // Attach listeners to filters
    document.querySelectorAll('.filters-container select').forEach(sel => {
        sel.addEventListener('change', () => {
            if (document.getElementById('reports-view').classList.contains('active')) {
                renderReports();
            }
        });
    });

    const resetBtn = document.getElementById('btn-reset-filters');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            document.querySelectorAll('.filters-container select').forEach(s => s.value = '');
            if (document.getElementById('reports-view').classList.contains('active')) {
                renderReports();
            }
        });
    }



    // --- DS NO AUTHORIZED QUERY ACTION ---
    document.body.addEventListener('click', async (e) => {
        if (e.target.closest('#detail-ts-query-btn')) {
            e.preventDefault();
            const querySection = document.getElementById('detail-authority-query-section');
            if (!querySection) return;
            
            const cid = querySection.getAttribute('data-current-id');
            const tsNo = document.getElementById('detail-ts-query-input').value.trim();
            if (!tsNo) return alert("Lütfen Dosya No giriniz");
            
            // Search in Service Complaints Data
            const cleanTsNo = tsNo.toLowerCase().replace(/\s+/g, '');
            const found = typeof serviceFilesData !== 'undefined' && serviceFilesData 
                ? serviceFilesData.find(x => Object.values(x).some(val => val && val.toString().toLowerCase().replace(/\s+/g, '').includes(cleanTsNo))) 
                : null;
                
            if (!found) return alert("Bu dosya numarasına ait veri (Google Sheets'de) bulunamadı.");
            
            let c = savedComplaints.find(x => x.id === cid);
            if (c) {
                // Merge dynamically mapped data
                c.data.tsNumber = tsNo;
                
                let caseNo = found['Hizmet Dosya No'] || found['Hizmet No'] || found['Dosya No'] || '-';
                if(caseNo !== '-') c.data.caseNo = caseNo;
                
                let bDate = found['ServiceCreatedDate'] || found['Bildirim Tarihi'] || found['Dosya Açılış Tarihi'] || found['Tarih'] || '-';
                if(bDate !== '-') c.data.caseDate = bDate;
                
                if(found['Müşteri']) c.data.customer = found['Müşteri'];
                if(found['İsim Soyisim'] || found['İsim']) c.data.name = found['İsim Soyisim'] || found['İsim'];
                
                let loc = found['IncidentPlaceProvince'] || found['İl'];
                if(loc) c.data.location = loc + (found['İlçe'] ? " / " + found['İlçe'] : "");
                
                if(found['ProvidedService'] || found['Hizmet Türü']) c.data.serviceType = found['ProvidedService'] || found['Hizmet Türü'];
                if(found['Provider'] || found['Tedarikçi'] || found['Atanan Tedarikçi']) c.data.provider = found['Provider'] || found['Tedarikçi'] || found['Atanan Tedarikçi'];
                
                // Add log
                c.logs = c.logs || [];
                c.logs.push({
                    date: new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
                    action: `Yetkili tarafından ${tsNo} nolu dosya verileri entegre edildi.`,
                    user: globalUser ? (globalUser["Ad Soyad"] || "Yetkili") : 'Sistem Görevlisi'
                });
                
                try {
                    saveComplaintsSafely();
                    viewComplaintDetails(cid);
                    alert("Dosya Bulundu: Dosya verileri başarıyla şikayet kaydına eklendi.");
                    document.getElementById('detail-ts-query-input').value = "";
                } catch(e) {
                    console.error("Storage error:", e);
                    alert("Kayıt sırasında hata oluştu!");
                }
            }
        }
    });
});
