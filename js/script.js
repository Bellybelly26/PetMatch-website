// CONFIGURAÇÃO SUPABASE
const SUPABASE_URL = 'sb_publishable_qkAJHEVU8XZfGXSUeNJLfA_43T8HGy_;
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uYWt5cGR3a2dxZmp4YWlyc3RkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3MzQxMzMsImV4cCI6MjA5NzMxMDEzM30.YeTSG2SvzNaWVbGShXVD90sYP72plAyhtmgfswK4fx8';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ESTADO GLOBAL
let currentUser = null;
let currentProfile = null;
let allPets = [];

// INICIALIZAÇÃO
document.addEventListener('DOMContentLoaded', async () => {
    await checkSession();
    initApp();
});

async function checkSession() {
    const { data: { session } } = await _supabase.auth.getSession();
    if (session) {
        currentUser = session.user;
        const { data: profile } = await _supabase
            .from('profiles')
            .select('*')
            .eq('id', currentUser.id)
            .single();
        currentProfile = profile;
        updateUI(true);
    } else {
        updateUI(false);
    }
}

function initApp() {
    loadPets();
    setupCounters();
    setupCarousel();
    setupTestimonials();
}

// --- NAVEGAÇÃO ---
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`page-${pageId}`).classList.add('active');
    document.getElementById('profileMenu').style.display = 'none';
    window.scrollTo(0,0);
    
    if(pageId === 'ong-admin') loadOngDashboard();
    if(pageId === 'my-requests') loadMyRequests();
    if(pageId === 'adopter-profile') fillProfileForm();
}

// --- AUTENTICAÇÃO ---
function openAuthModal() { document.getElementById('authModal').style.display = 'flex'; }
function closeAuthModal() { document.getElementById('authModal').style.display = 'none'; }

function selectUserType(type) {
    document.getElementById('userTypeSelection').style.display = 'none';
    document.getElementById('authTabs').style.display = 'block';
    const isOng = type === 'ong';
    document.getElementById('ongSignupForm').style.display = isOng ? 'block' : 'none';
    document.getElementById('adopterSignupForm').style.display = isOng ? 'none' : 'block';
    window.selectedRole = type;
}

function backToUserType() {
    document.getElementById('userTypeSelection').style.display = 'block';
    document.getElementById('authTabs').style.display = 'none';
}

async function handleSignup() {
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    const name = document.getElementById('signupName').value;

    const { data, error } = await _supabase.auth.signUp({ email, password });
    if (error) return alert(error.message);

    await _supabase.from('profiles').insert([
        { id: data.user.id, full_name: name, email, is_ong: false }
    ]);
    alert("Cadastro realizado! Verifique seu email.");
    location.reload();
}

async function handleOngSignup() {
    const email = document.getElementById('ongEmail').value;
    const password = document.getElementById('ongPassword').value;
    const name = document.getElementById('ongName').value;

    const { data, error } = await _supabase.auth.signUp({ email, password });
    if (error) return alert(error.message);

    await _supabase.from('profiles').insert([
        { id: data.user.id, full_name: name, email, is_ong: true, 
          phone: document.getElementById('ongPhone').value,
          address: document.getElementById('ongAddress').value,
          city: document.getElementById('ongCity').value }
    ]);
    alert("ONG Cadastrada com sucesso!");
    location.reload();
}

async function handleLogin() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const { error } = await _supabase.auth.signInWithPassword({ email, password });
    if (error) alert(error.message);
    else location.reload();
}

async function logout() {
    await _supabase.auth.signOut();
    location.reload();
}

function updateUI(isLoggedIn) {
    document.getElementById('btnLogin').style.display = isLoggedIn ? 'none' : 'block';
    document.getElementById('btnProfile').style.display = isLoggedIn ? 'flex' : 'none';
    if(isLoggedIn && currentProfile) {
        document.getElementById('userName').innerText = currentProfile.full_name;
        document.getElementById('ongAdminLink').style.display = currentProfile.is_ong ? 'block' : 'none';
    }
}

function toggleProfileMenu() {
    const m = document.getElementById('profileMenu');
    m.style.display = m.style.display === 'none' ? 'block' : 'none';
}

// --- CRUD DE PETS (GET) ---
async function loadPets() {
    const { data, error } = await _supabase.from('pets').select('*').eq('status', 'available');
    if (error) return console.error(error);
    allPets = data;
    renderPetsGrid(data);
}

function renderPetsGrid(pets) {
    const grid = document.getElementById('petsGrid');
    grid.innerHTML = pets.map(pet => `
        <div class="pet-card">
            <img src="${pet.image_url || 'https://via.placeholder.com/300x200?text=PetMatch'}" class="pet-img">
            <div class="pet-info">
                <h3>${pet.name}</h3>
                <p>${pet.breed} • ${pet.location}</p>
                <button class="btn-primary" style="width:100%" onclick="viewPetDetail('${pet.id}')">Conhecer</button>
            </div>
        </div>
    `).join('');
}

function filterPets() {
    const type = document.getElementById('filterType').value;
    const size = document.getElementById('filterSize').value;
    const search = document.getElementById('filterSearch').value.toLowerCase();
    
    const filtered = allPets.filter(p => {
        return (type === "" || p.type === type) &&
               (size === "" || p.size === size) &&
               (p.name.toLowerCase().includes(search) || p.breed.toLowerCase().includes(search));
    });
    renderPetsGrid(filtered);
}

// --- ADOÇÃO (POST) ---
async function viewPetDetail(id) {
    const pet = allPets.find(p => p.id === id);
    const content = document.getElementById('petDetailContent');
    content.innerHTML = `
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 20px;">
            <img src="${pet.image_url}" style="width:100%; border-radius:10px;">
            <div>
                <h2>${pet.name}</h2>
                <p><strong>Raça:</strong> ${pet.breed}</p>
                <p><strong>Tamanho:</strong> ${pet.size}</p>
                <p><strong>Local:</strong> ${pet.location}</p>
                <p>${pet.description || 'Sem descrição.'}</p>
                <button class="btn-primary" onclick="requestAdoption('${pet.id}')" style="margin-top:20px;">Solicitar Adoção</button>
            </div>
        </div>
    `;
    document.getElementById('petDetailModal').style.display = 'flex';
}

async function requestAdoption(petId) {
    if(!currentUser) return openAuthModal();
    const { error } = await _supabase.from('adoption_requests').insert([
        { pet_id: petId, adopter_id: currentUser.id }
    ]);
    if(error) alert("Erro ao solicitar");
    else {
        alert("Solicitação enviada!");
        document.getElementById('petDetailModal').style.display = 'none';
    }
}

function closePetDetailModal() { document.getElementById('petDetailModal').style.display = 'none'; }

// --- PAINEL ONG (GET, POST, PUT, DELETE) ---
async function loadOngDashboard() {
    const { data: pets } = await _supabase.from('pets').select('*').eq('ong_id', currentUser.id);
    document.getElementById('totalPets').innerText = pets.length;
    
    const list = document.getElementById('petsList');
    list.innerHTML = pets.map(p => `
        <div class="admin-pet-item" style="display:flex; justify-content:between; align-items:center; padding:10px; border-bottom:1px solid #ddd;">
            <span>${p.name} (${p.status})</span>
            <div>
                <button onclick="deletePet('${p.id}')" style="background:red; color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;">Excluir</button>
            </div>
        </div>
    `).join('');
}

async function deletePet(id) {
    if(confirm("Deseja excluir este pet?")) {
        await _supabase.from('pets').delete().eq('id', id);
        loadOngDashboard();
    }
}

// --- UTILITÁRIOS (CAROUSEL & COUNTERS) ---
function setupCounters() {
    const counters = document.querySelectorAll('.counter');
    counters.forEach(c => {
        const target = +c.dataset.target;
        c.innerText = target; // Simplificado para funcionamento imediato
    });
}

let carouselIdx = 0;
function setupCarousel() {
    const items = document.querySelectorAll('.carousel-item');
    if(!items.length) return;
    setInterval(() => {
        items[carouselIdx].classList.remove('active');
        carouselIdx = (carouselIdx + 1) % items.length;
        items[carouselIdx].classList.add('active');
        document.getElementById('carouselIndicator').innerText = `${carouselIdx + 1} / ${items.length}`;
    }, 5000);
}

function switchAuthTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.auth-tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`auth-${tab}`).classList.add('active');
    event.target.classList.add('active');
}

// Expôr funções para o HTML
window.showPage = showPage;
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.selectUserType = selectUserType;
window.handleLogin = handleLogin;
window.handleSignup = handleSignup;
window.handleOngSignup = handleOngSignup;
window.logout = logout;
window.toggleProfileMenu = toggleProfileMenu;
window.viewPetDetail = viewPetDetail;
window.closePetDetailModal = closePetDetailModal;
window.requestAdoption = requestAdoption;
window.filterPets = filterPets;
window.backToUserType = backToUserType;
window.switchAuthTab = switchAuthTab;
window.deletePet = deletePet;
});
