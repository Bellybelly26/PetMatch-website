const SUPABASE_URL = "https://onakypdwkgqfjxairstd.supabase.co";

const SUPABASE_ANON_KEY =
"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uYWt5cGR3a2dxZmp4YWlyc3RkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3MzQxMzMsImV4cCI6MjA5NzM";

const supabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);

// Evento do botão cadastrar
document.getElementById("bnt-cadastro").addEventListener("click", async function(event) {
    event.preventDefault(); // Impede a página de recarregar e quebrar o fluxo

    // Correção: Buscando os valores digitados nos inputs corretos do HTML
    const email = document.getElementById("email").value;
    const senha = document.getElementById("senha").value;
    
        // Adicionado async/await correto para fazer a comunicação com o Supabase Auth
        const { data, error } = await supabase.auth.signUp({
            email,
            password: senha,
        });

        if (error) {
            alert(error.message);
            return;
        }
        
        alert("Cadastro realizado com sucesso!");
            console.log(data);
        });
    } catch (err) {
        console.error(err);
    }
});

// ===== ESTADO GLOBAL =====
let currentUser = null;
let currentPage = 'home';
let currentCarouselIndex = 0;
let currentTestimonialIndex = 0;
let currentAdminTab = 'dashboard';
let currentChatId = null;

// ===== INICIALIZAÇÃO =====
document.addEventListener('DOMContentLoaded', () => {
  loadUserFromStorage();
  showPage('home');
  animateCounters();
  startCarouselAutoPlay();
  startTestimonialAutoPlay();
  renderPets();
});

// ===== AUTENTICAÇÃO =====
function openAuthModal() {
  document.getElementById('authModal').classList.add('active');
  document.getElementById('userTypeSelection').style.display = 'block';
  document.getElementById('authTabs').style.display = 'none';
}

function closeAuthModal() {
  document.getElementById('authModal').classList.remove('active');
}

function selectUserType(type) {
  document.getElementById('userTypeSelection').style.display = 'none';
  document.getElementById('authTabs').style.display = 'block';
  
  // Armazenar tipo de usuário
  const authTabs = document.getElementById('authTabs');
  authTabs.dataset.type = type;
  
  // Mostrar formulário correto no signup
  if (type === 'ong') {
    document.getElementById('adopterSignupForm').style.display = 'none';
    document.getElementById('ongSignupForm').style.display = 'block';
  } else {
    document.getElementById('adopterSignupForm').style.display = 'block';
    document.getElementById('ongSignupForm').style.display = 'none';
  }
  
  switchAuthTab('login');
}

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.auth-tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('auth-' + tab).classList.add('active');
  document.querySelector(`[onclick="switchAuthTab('${tab}')"]`).classList.add('active');
  
  // Se for signup, mostrar o formulário correto
  if (tab === 'signup') {
    const userType = document.querySelector('[data-type]')?.dataset.type || 'adopter';
    if (userType === 'ong') {
      document.getElementById('adopterSignupForm').style.display = 'none';
      document.getElementById('ongSignupForm').style.display = 'block';
    } else {
      document.getElementById('adopterSignupForm').style.display = 'block';
      document.getElementById('ongSignupForm').style.display = 'none';
    }
  }
}

function backToUserType() {
  document.getElementById('userTypeSelection').style.display = 'block';
  document.getElementById('authTabs').style.display = 'none';
}

function handleLogin() {
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  const userType = document.querySelector('.user-type-card').dataset.type || 'adopter';

  const user = database.users.find(u => u.email === email && u.password === password);

  if (user) {
    currentUser = user;
    localStorage.setItem('currentUser', JSON.stringify(user));
    closeAuthModal();
    updateHeader();
    showPage('home');
    alert(`Bem-vindo, ${user.name}!`);
  } else {
    alert('Email ou senha incorretos!');
  }
}

function handleSignup() {
  const name = document.getElementById('signupName').value;
  const email = document.getElementById('signupEmail').value;
  const password = document.getElementById('signupPassword').value;
  const userType = document.querySelector('.user-type-card').dataset.type || 'adopter';

  if (database.users.find(u => u.email === email)) {
    alert('Email já cadastrado!');
    return;
  }

  const newUser = {
    id: database.users.length + 1,
    email,
    password,
    name,
    userType
  };

  database.users.push(newUser);
  currentUser = newUser;
  localStorage.setItem('currentUser', JSON.stringify(newUser));
  closeAuthModal();
  updateHeader();
  showPage('home');
  alert(`Cadastro realizado com sucesso, ${name}!`);
}

function handleOngSignup() {
  const name = document.getElementById('ongName').value;
  const email = document.getElementById('ongEmail').value;
  const phone = document.getElementById('ongPhone').value;
  const address = document.getElementById('ongAddress').value;
  const city = document.getElementById('ongCity').value;
  const password = document.getElementById('ongPassword').value;

  if (database.users.find(u => u.email === email)) {
    alert('Email já cadastrado!');
    return;
  }

  const newUser = {
    id: database.users.length + 1,
    email,
    password,
    name,
    userType: 'ong'
  };

  const newOng = {
    id: database.ongs.length + 1,
    userId: newUser.id,
    name,
    phone,
    address,
    city
  };

  database.users.push(newUser);
  database.ongs.push(newOng);
  currentUser = newUser;
  localStorage.setItem('currentUser', JSON.stringify(newUser));
  closeAuthModal();
  updateHeader();
  showPage('ong-admin');
  alert(`ONG cadastrada com sucesso, ${name}!`);
}

function logout() {
  currentUser = null;
  localStorage.removeItem('currentUser');
  updateHeader();
  showPage('home');
  document.getElementById('profileMenu').style.display = 'none';
  alert('Você foi desconectado!');
}

function loadUserFromStorage() {
  const stored = localStorage.getItem('currentUser');
  if (stored) {
    currentUser = JSON.parse(stored);
    updateHeader();
  }
}

function updateHeader() {
  const btnLogin = document.getElementById('btnLogin');
  const btnProfile = document.getElementById('btnProfile');
  const ongAdminLink = document.getElementById('ongAdminLink');

  if (currentUser) {
    btnLogin.style.display = 'none';
    btnProfile.style.display = 'block';
    document.getElementById('userName').textContent = currentUser.name;
    
    // Mostrar painel ONG apenas se o usuário for ONG
    if (currentUser.userType === 'ong') {
      ongAdminLink.style.display = 'block';
    } else {
      ongAdminLink.style.display = 'none';
    }
  } else {
    btnLogin.style.display = 'block';
    btnProfile.style.display = 'none';
    ongAdminLink.style.display = 'none';
  }
}

function toggleProfileMenu() {
  const menu = document.getElementById('profileMenu');
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.btn-profile') && !e.target.closest('.profile-menu')) {
    document.getElementById('profileMenu').style.display = 'none';
  }
});

// ===== NAVEGAÇÃO =====
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  currentPage = page;

  if (page === 'pets') {
    renderPets();
  } else if (page === 'my-requests') {
    renderMyRequests();
  } else if (page === 'chat') {
    renderChatList();
  } else if (page === 'ong-admin') {
    updateAdminDashboard();
  }

  window.scrollTo(0, 0);
}

// ===== CAROUSEL =====
function nextCarousel() {
  currentCarouselIndex = (currentCarouselIndex + 1) % 2;
  updateCarousel();
}

function prevCarousel() {
  currentCarouselIndex = (currentCarouselIndex - 1 + 2) % 2;
  updateCarousel();
}

function updateCarousel() {
  document.querySelectorAll('.carousel-item').forEach((item, i) => {
    item.classList.toggle('active', i === currentCarouselIndex);
  });
  document.getElementById('carouselIndicator').textContent = `${currentCarouselIndex + 1} / 2`;
}

function startCarouselAutoPlay() {
  setInterval(() => {
    nextCarousel();
  }, 6000);
}

// ===== TESTIMONIALS =====
function switchTestimonial(index) {
  currentTestimonialIndex = index;
  updateTestimonials();
}

function updateTestimonials() {
  document.querySelectorAll('.testimonial').forEach((t, i) => {
    t.classList.toggle('active', i === currentTestimonialIndex);
  });
  document.querySelectorAll('.indicator').forEach((ind, i) => {
    ind.classList.toggle('active', i === currentTestimonialIndex);
  });
}

function startTestimonialAutoPlay() {
  setInterval(() => {
    currentTestimonialIndex = (currentTestimonialIndex + 1) % 3;
    updateTestimonials();
  }, 5000);
}

// ===== CONTADORES ANIMADOS =====
function animateCounters() {
  document.querySelectorAll('.counter').forEach(counter => {
    const target = parseInt(counter.dataset.target);
    let current = 0;
    const increment = target / 50;

    const timer = setInterval(() => {
      current += increment;
      if (current >= target) {
        counter.textContent = target.toLocaleString();
        clearInterval(timer);
      } else {
        counter.textContent = Math.floor(current).toLocaleString();
      }
    }, 30);
  });
}

// ===== PETS PAGE =====
function renderPets() {
  const grid = document.getElementById('petsGrid');
  grid.innerHTML = '';

  let pets = [...database.pets];

  // Aplicar filtros
  const typeFilter = document.getElementById('filterType')?.value;
  const sizeFilter = document.getElementById('filterSize')?.value;
  const locationFilter = document.getElementById('filterLocation')?.value.toLowerCase();
  const searchFilter = document.getElementById('filterSearch')?.value.toLowerCase();
  const favoritesOnly = document.getElementById('filterFavorites')?.checked;

  if (typeFilter) pets = pets.filter(p => p.type === typeFilter);
  if (sizeFilter) pets = pets.filter(p => p.size === sizeFilter);
  if (locationFilter) pets = pets.filter(p => p.city.toLowerCase().includes(locationFilter));
  if (searchFilter) pets = pets.filter(p => p.name.toLowerCase().includes(searchFilter) || p.breed.toLowerCase().includes(searchFilter));
  if (favoritesOnly) pets = pets.filter(p => database.favorites.includes(p.id));

  pets.forEach(pet => {
    const isFavorite = database.favorites.includes(pet.id);
    const card = document.createElement('div');
    card.className = 'pet-card';
    card.innerHTML = `
      <img src="${pet.image}" alt="${pet.name}" class="pet-image">
      <div class="pet-info">
        <div class="pet-name">${pet.name}</div>
        <div class="pet-details">${pet.breed}</div>
        <div class="pet-details">${pet.age} anos • ${pet.size}</div>
        <div class="pet-details">📍 ${pet.city}</div>
        <div class="pet-actions">
          <button class="btn-favorite ${isFavorite ? 'active' : ''}" onclick="toggleFavorite(${pet.id})">
            ${isFavorite ? '❤️' : '🤍'}
          </button>
          <button class="btn-adopt" onclick="openPetDetail(${pet.id})">Detalhes</button>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}

function filterPets() {
  renderPets();
}

function toggleFavorite(petId) {
  const index = database.favorites.indexOf(petId);
  if (index > -1) {
    database.favorites.splice(index, 1);
  } else {
    database.favorites.push(petId);
  }
  renderPets();
}

function openPetDetail(petId) {
  const pet = database.pets.find(p => p.id === petId);
  const modal = document.getElementById('petDetailModal');
  const content = document.getElementById('petDetailContent');

  content.innerHTML = `
    <h2>${pet.name}</h2>
    <img src="${pet.image}" alt="${pet.name}" style="width:100%; border-radius:12px; margin:1rem 0;">
    <div style="background: var(--light-bg); padding: 1rem; border-radius: 12px; margin: 1rem 0;">
      <p><strong>Raça:</strong> ${pet.breed}</p>
      <p><strong>Idade:</strong> ${pet.age} anos</p>
      <p><strong>Tamanho:</strong> ${pet.size}</p>
      <p><strong>Energia:</strong> ${pet.energy}</p>
      <p><strong>Localização:</strong> ${pet.city}, PR</p>
    </div>
    <div style="margin: 1rem 0;">
      <h3>Sobre ${pet.name}</h3>
      <p>Um lindo ${pet.breed} procurando por um lar amoroso. Está vacinado e pronto para adoção!</p>
    </div>
    <button class="btn-primary" style="width:100%; margin-bottom:0.5rem;" onclick="requestAdoption(${pet.id})">Quero Adotar!</button>
    <button class="btn-secondary" style="width:100%;" onclick="closePetDetailModal()">Fechar</button>
  `;

  modal.classList.add('active');
}

function closePetDetailModal() {
  document.getElementById('petDetailModal').classList.remove('active');
}

function requestAdoption(petId) {
  if (!currentUser) {
    alert('Faça login para solicitar adoção!');
    openAuthModal();
    return;
  }

  const pet = database.pets.find(p => p.id === petId);
  const request = {
    id: database.adoptionRequests.length + 1,
    petId,
    petName: pet.name,
    adopterId: currentUser.id,
    adopterName: currentUser.name,
    status: 'pending',
    date: new Date().toLocaleDateString()
  };

  database.adoptionRequests.push(request);
  closePetDetailModal();
  alert(`Solicitação de adoção enviada para ${pet.name}!`);
}

// ===== PERFIL DE ADOTADOR =====
function saveAdopterProfile(e) {
  e.preventDefault();
  if (!currentUser) return;

  alert('Perfil salvo com sucesso!');
  showPage('home');
}

function previewProfilePhoto() {
  const file = document.getElementById('profilePhoto').files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const preview = document.getElementById('profilePhotoPreview');
      preview.innerHTML = `<img src="${e.target.result}" style="max-width:200px; border-radius:12px;">`;
    };
    reader.readAsDataURL(file);
  }
}

function previewResidencePhotos() {
  const files = document.getElementById('residencePhotos').files;
  const preview = document.getElementById('residencePhotosPreview');
  preview.innerHTML = '';

  Array.from(files).forEach(file => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = document.createElement('img');
      img.src = e.target.result;
      img.style.cssText = 'max-width:150px; margin:0.5rem; border-radius:8px;';
      preview.appendChild(img);
    };
    reader.readAsDataURL(file);
  });
}

function previewResidenceVideos() {
  const files = document.getElementById('residenceVideos').files;
  const preview = document.getElementById('residenceVideosPreview');
  preview.innerHTML = '';

  Array.from(files).forEach(file => {
    const video = document.createElement('video');
    video.src = URL.createObjectURL(file);
    video.style.cssText = 'max-width:150px; margin:0.5rem; border-radius:8px;';
    video.controls = true;
    preview.appendChild(video);
  });
}

// ===== MINHAS SOLICITAÇÕES =====
function renderMyRequests() {
  if (!currentUser) return;

  const list = document.getElementById('requestsList');
  const myRequests = database.adoptionRequests.filter(r => r.adopterId === currentUser.id);

  if (myRequests.length === 0) {
    list.innerHTML = '<p style="text-align:center; color:#999;">Você ainda não fez nenhuma solicitação.</p>';
    return;
  }

  list.innerHTML = myRequests.map(req => `
    <div style="background: var(--light-bg); padding: 1.5rem; border-radius: 12px; margin-bottom: 1rem; border-left: 4px solid var(--primary-blue);">
      <h3>${req.petName}</h3>
      <p><strong>Status:</strong> <span style="color: ${req.status === 'approved' ? 'green' : req.status === 'rejected' ? 'red' : 'orange'};">${req.status}</span></p>
      <p><strong>Data:</strong> ${req.date}</p>
      <button class="btn-primary" onclick="openChat(${req.id})">Conversar com ONG</button>
    </div>
  `).join('');
}

// ===== PAINEL ADMINISTRATIVO ONG =====
function switchAdminTab(tab) {
  currentAdminTab = tab;
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`admin-${tab}`).classList.add('active');
  event.target.classList.add('active');

  if (tab === 'requests') {
    renderAdminRequests();
  } else if (tab === 'visits') {
    renderAdminVisits();
  } else if (tab === 'pets') {
    renderAdminPets();
  }
}

function updateAdminDashboard() {
  document.getElementById('totalPets').textContent = database.pets.length;
  document.getElementById('pendingRequests').textContent = database.adoptionRequests.filter(r => r.status === 'pending').length;
  document.getElementById('approvedAdoptions').textContent = database.adoptionRequests.filter(r => r.status === 'approved').length;
}

function renderAdminPets() {
  const list = document.getElementById('petsList');
  list.innerHTML = database.pets.map(pet => `
    <div style="background: var(--light-bg); padding: 1rem; border-radius: 12px; margin-bottom: 1rem; display:flex; justify-content:space-between; align-items:center;">
      <div>
        <strong>${pet.name}</strong> - ${pet.breed}
        <p style="font-size:0.9rem; color:#666;">${pet.city}, PR</p>
      </div>
      <button class="btn-secondary" onclick="alert('Editar pet: ${pet.name}')">Editar</button>
    </div>
  `).join('');
}

function renderAdminRequests() {
  const list = document.getElementById('requestsListAdmin');
  list.innerHTML = database.adoptionRequests.map(req => `
    <div style="background: var(--light-bg); padding: 1.5rem; border-radius: 12px; margin-bottom: 1rem;">
      <h4>${req.petName}</h4>
      <p><strong>Adotador:</strong> ${req.adopterName}</p>
      <p><strong>Status:</strong> ${req.status}</p>
      <div style="display:flex; gap:0.5rem; margin-top:1rem;">
        <button class="btn-primary" onclick="approveRequest(${req.id})">Aprovar</button>
        <button class="btn-secondary" onclick="rejectRequest(${req.id})">Rejeitar</button>
      </div>
    </div>
  `).join('');
}

function approveRequest(requestId) {
  const req = database.adoptionRequests.find(r => r.id === requestId);
  req.status = 'approved';
  renderAdminRequests();
  alert(`Solicitação de ${req.adopterName} aprovada!`);
}

function rejectRequest(requestId) {
  const req = database.adoptionRequests.find(r => r.id === requestId);
  req.status = 'rejected';
  renderAdminRequests();
  alert(`Solicitação de ${req.adopterName} rejeitada!`);
}

function renderAdminVisits() {
  const list = document.getElementById('visitsList');
  list.innerHTML = '<p style="text-align:center; color:#999;">Nenhuma visita agendada.</p>';
}

function openAddPetForm() {
  alert('Formulário de adição de pet (em desenvolvimento)');
}
