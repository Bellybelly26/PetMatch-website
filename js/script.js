// ============================================================================
// CONFIGURAÇÃO CENTRALIZADA DO SUPABASE
// ============================================================================
// IMPORTANTE: a URL do projeto é sempre "https://<ref>.supabase.co".
// O "ref" abaixo (onakypdwkgqfjxairstd) foi extraído do próprio anon key
// (o JWT contém o campo "ref"), já que a URL não estava configurada corretamente.
// Ao trocar de projeto Supabase, atualize as duas constantes em
// Settings > API do painel do Supabase.
const SUPABASE_URL = "https://onakypdwkgqfjxairstd.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uYWt5cGR3a2dxZmp4YWlyc3RkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3MzQxMzMsImV4cCI6MjA5NzMxMDEzM30.YeTSG2SvzNaWVbGShXVD90sYP72plAyhtmgfswK4fx8";

// OBS: usamos "sb" (e não "supabase") para o cliente, porque o próprio SDK
// carregado pelo <script> do CDN expõe o objeto global "supabase" — usar o
// mesmo nome para a constante local causava o erro
// "Cannot access 'supabase' before initialization".
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== ESTADO GLOBAL =====
let currentUser = null;     // registro combinado de auth.user + profiles
let currentPage = 'home';
let currentCarouselIndex = 0;
let currentTestimonialIndex = 0;
let currentAdminTab = 'dashboard';
let allPets = [];           // cache dos pets carregados na página "Pets"
let myFavoritePetIds = [];  // cache dos ids favoritados pelo adotador logado
let editingPetId = null;    // usado pelo formulário de adicionar/editar pet

// ===== INICIALIZAÇÃO =====
document.addEventListener('DOMContentLoaded', () => {
  restoreSession();
  showPage('home');
  animateCounters();
  startCarouselAutoPlay();
  startTestimonialAutoPlay();
  renderPets();
});

// ============================================================================
// AUTENTICAÇÃO (Supabase Auth + tabela profiles)
// ============================================================================

async function restoreSession() {
  const { data, error } = await sb.auth.getSession();
  if (error || !data.session) return;

  const { data: profile } = await sb
    .from('profiles')
    .select('*')
    .eq('id', data.session.user.id)
    .single();

  if (profile) {
    currentUser = profile;
    updateHeader();
  }
}

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

  const authTabs = document.getElementById('authTabs');
  authTabs.dataset.type = type;

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

  if (tab === 'signup') {
    const userType = document.getElementById('authTabs')?.dataset.type || 'adopter';
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

// ----- Validação simples de formulários -----
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateAuthFields(fields) {
  for (const [label, value] of Object.entries(fields)) {
    if (!value || !value.trim()) {
      alert(`Preencha o campo "${label}".`);
      return false;
    }
  }
  return true;
}

async function handleLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!validateAuthFields({ Email: email, Senha: password })) return;
  if (!isValidEmail(email)) {
    alert('Digite um e-mail válido.');
    return;
  }

  const { data, error } = await sb.auth.signInWithPassword({ email, password });

  if (error) {
    alert('Email ou senha incorretos!');
    return;
  }

  const { data: profile, error: profileError } = await sb
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .single();

  if (profileError || !profile) {
    alert('Erro ao carregar seu perfil. Tente novamente.');
    return;
  }

  currentUser = profile;
  closeAuthModal();
  updateHeader();
  showPage('home');
  alert(`Bem-vindo, ${currentUser.name}!`);
}

async function handleSignup() {
  const name = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;

  if (!validateAuthFields({ Nome: name, Email: email, Senha: password })) return;
  if (!isValidEmail(email)) {
    alert('Digite um e-mail válido.');
    return;
  }
  if (password.length < 6) {
    alert('A senha deve ter pelo menos 6 caracteres.');
    return;
  }

  // name/user_type vão em options.data (user_metadata); o trigger
  // on_auth_user_created (supabase-auth-trigger.sql) usa esses dados
  // para criar a linha em public.profiles automaticamente.
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { name, user_type: 'adopter' } }
  });

  if (error) {
    alert('Erro ao cadastrar: ' + error.message);
    return;
  }

  if (!data.session) {
    // Projeto configurado para exigir confirmação por e-mail
    closeAuthModal();
    alert(`Cadastro realizado, ${name}! Verifique seu e-mail para confirmar a conta antes de entrar.`);
    return;
  }

  currentUser = { id: data.user.id, email, name, user_type: 'adopter' };
  closeAuthModal();
  updateHeader();
  showPage('home');
  alert(`Cadastro realizado com sucesso, ${name}!`);
}

async function handleOngSignup() {
  const name = document.getElementById('ongName').value.trim();
  const email = document.getElementById('ongEmail').value.trim();
  const phone = document.getElementById('ongPhone').value.trim();
  const address = document.getElementById('ongAddress').value.trim();
  const city = document.getElementById('ongCity').value.trim();
  const password = document.getElementById('ongPassword').value;

  if (!validateAuthFields({ 'Nome da ONG': name, Email: email, Cidade: city, Senha: password })) return;
  if (!isValidEmail(email)) {
    alert('Digite um e-mail válido.');
    return;
  }
  if (password.length < 6) {
    alert('A senha deve ter pelo menos 6 caracteres.');
    return;
  }

  // Mesma lógica do adotador: os dados vão em options.data e o trigger
  // cria a linha em public.profiles automaticamente.
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { name, user_type: 'ong', phone, address, city } }
  });

  if (error) {
    alert('Erro ao cadastrar: ' + error.message);
    return;
  }

  if (!data.session) {
    closeAuthModal();
    alert(`ONG cadastrada, ${name}! Verifique o e-mail para confirmar a conta antes de entrar.`);
    return;
  }

  currentUser = { id: data.user.id, email, name, user_type: 'ong', phone, address, city };
  closeAuthModal();
  updateHeader();
  showPage('ong-admin');
  alert(`ONG cadastrada com sucesso, ${name}!`);
}

async function logout() {
  await sb.auth.signOut();
  currentUser = null;
  updateHeader();
  showPage('home');
  document.getElementById('profileMenu').style.display = 'none';
  alert('Você foi desconectado!');
}

function updateHeader() {
  const btnLogin = document.getElementById('btnLogin');
  const btnProfile = document.getElementById('btnProfile');
  const ongAdminLink = document.getElementById('ongAdminLink');

  if (currentUser) {
    btnLogin.style.display = 'none';
    btnProfile.style.display = 'block';
    document.getElementById('userName').textContent = currentUser.name;

    if (currentUser.user_type === 'ong') {
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

// ============================================================================
// NAVEGAÇÃO
// ============================================================================
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  currentPage = page;

  if (page === 'pets') {
    renderPets();
  } else if (page === 'my-requests') {
    renderMyRequests();
  } else if (page === 'adopter-profile') {
    loadAdopterProfileForm();
  } else if (page === 'ong-admin') {
    if (!currentUser || currentUser.user_type !== 'ong') {
      alert('Apenas ONGs têm acesso ao painel administrativo.');
      showPage('home');
      return;
    }
    switchAdminTab('dashboard');
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

// ============================================================================
// PETS PAGE (GET + filtros)
// ============================================================================
async function renderPets() {
  const grid = document.getElementById('petsGrid');
  if (!grid) return;
  grid.innerHTML = '<p style="text-align:center; color:#999;">Carregando pets...</p>';

  const { data: pets, error } = await sb
    .from('pets')
    .select('*')
    .eq('status', 'available')
    .order('created_at', { ascending: false });

  if (error) {
    grid.innerHTML = `<p style="text-align:center; color:#999;">Erro ao carregar pets: ${error.message}</p>`;
    return;
  }

  allPets = pets || [];

  if (currentUser && currentUser.user_type === 'adopter') {
    const { data: favs } = await sb
      .from('favorites')
      .select('pet_id')
      .eq('adopter_id', currentUser.id);
    myFavoritePetIds = (favs || []).map(f => f.pet_id);
  } else {
    myFavoritePetIds = [];
  }

  applyPetFilters();
}

function applyPetFilters() {
  const grid = document.getElementById('petsGrid');
  grid.innerHTML = '';

  let pets = [...allPets];

  const typeFilter = document.getElementById('filterType')?.value;
  const sizeFilter = document.getElementById('filterSize')?.value;
  const locationFilter = document.getElementById('filterLocation')?.value.toLowerCase();
  const searchFilter = document.getElementById('filterSearch')?.value.toLowerCase();
  const favoritesOnly = document.getElementById('filterFavorites')?.checked;

  if (typeFilter) pets = pets.filter(p => p.type === typeFilter);
  if (sizeFilter) pets = pets.filter(p => p.size === sizeFilter);
  if (locationFilter) pets = pets.filter(p => p.city.toLowerCase().includes(locationFilter));
  if (searchFilter) pets = pets.filter(p => p.name.toLowerCase().includes(searchFilter) || p.breed.toLowerCase().includes(searchFilter));
  if (favoritesOnly) pets = pets.filter(p => myFavoritePetIds.includes(p.id));

  if (pets.length === 0) {
    grid.innerHTML = '<p style="text-align:center; color:#999; grid-column: 1 / -1;">Nenhum pet encontrado.</p>';
    return;
  }

  pets.forEach(pet => {
    const isFavorite = myFavoritePetIds.includes(pet.id);
    const card = document.createElement('div');
    card.className = 'pet-card';
    card.innerHTML = `
      <img src="${pet.image_url || 'images/pet-dog-brown-1.png'}" alt="${pet.name}" class="pet-image">
      <div class="pet-info">
        <div class="pet-name">${pet.name}</div>
        <div class="pet-details">${pet.breed}</div>
        <div class="pet-details">${pet.age} anos • ${pet.size}</div>
        <div class="pet-details">📍 ${pet.city}</div>
        <div class="pet-actions">
          <button class="btn-favorite ${isFavorite ? 'active' : ''}" onclick="toggleFavorite('${pet.id}')">
            ${isFavorite ? '❤️' : '🤍'}
          </button>
          <button class="btn-adopt" onclick="openPetDetail('${pet.id}')">Detalhes</button>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}

function filterPets() {
  applyPetFilters();
}

async function toggleFavorite(petId) {
  if (!currentUser || currentUser.user_type !== 'adopter') {
    alert('Faça login como adotador para favoritar pets!');
    openAuthModal();
    return;
  }

  const isFavorite = myFavoritePetIds.includes(petId);

  if (isFavorite) {
    const { error } = await sb
      .from('favorites')
      .delete()
      .eq('adopter_id', currentUser.id)
      .eq('pet_id', petId);
    if (error) { alert('Erro ao remover favorito: ' + error.message); return; }
  } else {
    const { error } = await sb
      .from('favorites')
      .insert([{ adopter_id: currentUser.id, pet_id: petId }]);
    if (error) { alert('Erro ao favoritar: ' + error.message); return; }
  }

  if (isFavorite) {
    myFavoritePetIds = myFavoritePetIds.filter(id => id !== petId);
  } else {
    myFavoritePetIds.push(petId);
  }
  applyPetFilters();
}

function openPetDetail(petId) {
  const pet = allPets.find(p => p.id === petId);
  if (!pet) return;
  const modal = document.getElementById('petDetailModal');
  const content = document.getElementById('petDetailContent');

  content.innerHTML = `
    <h2>${pet.name}</h2>
    <img src="${pet.image_url || 'images/pet-dog-brown-1.png'}" alt="${pet.name}" style="width:100%; border-radius:12px; margin:1rem 0;">
    <div style="background: var(--light-bg); padding: 1rem; border-radius: 12px; margin: 1rem 0;">
      <p><strong>Raça:</strong> ${pet.breed}</p>
      <p><strong>Idade:</strong> ${pet.age} anos</p>
      <p><strong>Tamanho:</strong> ${pet.size}</p>
      <p><strong>Energia:</strong> ${pet.energy || 'Moderada'}</p>
      <p><strong>Localização:</strong> ${pet.city}, PR</p>
    </div>
    <div style="margin: 1rem 0;">
      <h3>Sobre ${pet.name}</h3>
      <p>Um lindo ${pet.breed} procurando por um lar amoroso. Está vacinado e pronto para adoção!</p>
    </div>
    <button class="btn-primary" style="width:100%; margin-bottom:0.5rem;" onclick="requestAdoption('${pet.id}')">Quero Adotar!</button>
    <button class="btn-secondary" style="width:100%;" onclick="closePetDetailModal()">Fechar</button>
  `;

  modal.classList.add('active');
}

function closePetDetailModal() {
  document.getElementById('petDetailModal').classList.remove('active');
}

async function requestAdoption(petId) {
  if (!currentUser || currentUser.user_type !== 'adopter') {
    alert('Faça login como adotador para solicitar adoção!');
    openAuthModal();
    return;
  }

  const { data: existing } = await sb
    .from('adoption_requests')
    .select('id')
    .eq('pet_id', petId)
    .eq('adopter_id', currentUser.id)
    .eq('status', 'pending');

  if (existing && existing.length > 0) {
    alert('Você já tem uma solicitação pendente para este pet.');
    closePetDetailModal();
    return;
  }

  const { error } = await sb.from('adoption_requests').insert([{
    pet_id: petId,
    adopter_id: currentUser.id,
    status: 'pending'
  }]);

  if (error) {
    alert('Erro ao enviar solicitação: ' + error.message);
    return;
  }

  const pet = allPets.find(p => p.id === petId);
  closePetDetailModal();
  alert(`Solicitação de adoção enviada para ${pet ? pet.name : 'o pet'}!`);
}

// ============================================================================
// PERFIL DE ADOTADOR (GET + PUT + upload de arquivos)
// ============================================================================
async function loadAdopterProfileForm() {
  if (!currentUser) return;
  document.getElementById('adopterName').value = currentUser.name || '';
  document.getElementById('adopterEmail').value = currentUser.email || '';
  document.getElementById('adopterPhone').value = currentUser.phone || '';
  document.getElementById('adopterAddress').value = currentUser.address || '';
  document.getElementById('adopterCity').value = currentUser.city || '';

  const photoPreview = document.getElementById('profilePhotoPreview');
  if (currentUser.profile_photo_url) {
    photoPreview.innerHTML = `<img src="${currentUser.profile_photo_url}" style="max-width:200px; border-radius:12px;">`;
  }
}

async function uploadFileToBucket(bucket, file, pathPrefix) {
  const ext = file.name.split('.').pop();
  const path = `${pathPrefix}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await sb.storage.from(bucket).upload(path, file);
  if (error) throw error;
  const { data } = sb.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

async function saveAdopterProfile(e) {
  e.preventDefault();
  if (!currentUser) return;

  const name = document.getElementById('adopterName').value.trim();
  const email = document.getElementById('adopterEmail').value.trim();
  const phone = document.getElementById('adopterPhone').value.trim();
  const address = document.getElementById('adopterAddress').value.trim();
  const city = document.getElementById('adopterCity').value.trim();

  if (!name || !email) {
    alert('Nome e e-mail são obrigatórios.');
    return;
  }
  if (!isValidEmail(email)) {
    alert('Digite um e-mail válido.');
    return;
  }

  const updates = { name, email, phone, address, city };

  try {
    const photoFile = document.getElementById('profilePhoto').files[0];
    if (photoFile) {
      updates.profile_photo_url = await uploadFileToBucket('user-uploads', photoFile, `profile-photos/${currentUser.id}`);
    }

    const residencePhotoFiles = Array.from(document.getElementById('residencePhotos').files);
    if (residencePhotoFiles.length > 0) {
      const urls = [];
      for (const file of residencePhotoFiles) {
        urls.push(await uploadFileToBucket('user-uploads', file, `residence-photos/${currentUser.id}`));
      }
      updates.residence_photos = urls;
    }

    const residenceVideoFiles = Array.from(document.getElementById('residenceVideos').files);
    if (residenceVideoFiles.length > 0) {
      const urls = [];
      for (const file of residenceVideoFiles) {
        urls.push(await uploadFileToBucket('user-uploads', file, `residence-videos/${currentUser.id}`));
      }
      updates.residence_videos = urls;
    }
  } catch (uploadError) {
    alert('Erro ao enviar arquivos: ' + uploadError.message);
    return;
  }

  const { error } = await sb.from('profiles').update(updates).eq('id', currentUser.id);

  if (error) {
    alert('Erro ao salvar perfil: ' + error.message);
    return;
  }

  currentUser = { ...currentUser, ...updates };
  updateHeader();
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

// ============================================================================
// MINHAS SOLICITAÇÕES (GET com join)
// ============================================================================
async function renderMyRequests() {
  if (!currentUser) return;

  const list = document.getElementById('requestsList');
  list.innerHTML = '<p style="text-align:center; color:#999;">Carregando...</p>';

  const { data: requests, error } = await sb
    .from('adoption_requests')
    .select('id, status, created_at, pet_id, pets(name, ong_id)')
    .eq('adopter_id', currentUser.id)
    .order('created_at', { ascending: false });

  if (error) {
    list.innerHTML = `<p style="text-align:center; color:#999;">Erro ao carregar solicitações: ${error.message}</p>`;
    return;
  }

  if (!requests || requests.length === 0) {
    list.innerHTML = '<p style="text-align:center; color:#999;">Você ainda não fez nenhuma solicitação.</p>';
    return;
  }

  list.innerHTML = requests.map(req => `
    <div style="background: var(--light-bg); padding: 1.5rem; border-radius: 12px; margin-bottom: 1rem; border-left: 4px solid var(--primary-blue);">
      <h3>${req.pets ? req.pets.name : 'Pet removido'}</h3>
      <p><strong>Status:</strong> <span style="color: ${req.status === 'approved' ? 'green' : req.status === 'rejected' ? 'red' : 'orange'};">${req.status}</span></p>
      <p><strong>Data:</strong> ${new Date(req.created_at).toLocaleDateString()}</p>
      <button class="btn-primary" onclick="showOngContact('${req.pets ? req.pets.ong_id : ''}')">Contato da ONG</button>
    </div>
  `).join('');
}

async function showOngContact(ongId) {
  if (!ongId) {
    alert('Não foi possível encontrar os dados da ONG.');
    return;
  }
  const { data: ong, error } = await sb
    .from('profiles')
    .select('name, phone, address, city, email')
    .eq('id', ongId)
    .single();

  if (error || !ong) {
    alert('Não foi possível carregar os dados da ONG.');
    return;
  }

  alert(
    `${ong.name}\n` +
    `E-mail: ${ong.email}\n` +
    (ong.phone ? `Telefone: ${ong.phone}\n` : '') +
    (ong.address ? `Endereço: ${ong.address}\n` : '') +
    (ong.city ? `Cidade: ${ong.city}` : '')
  );
}

// ============================================================================
// PAINEL ADMINISTRATIVO ONG (CRUD completo de pets + solicitações + visitas)
// ============================================================================
function switchAdminTab(tab) {
  currentAdminTab = tab;
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`admin-${tab}`).classList.add('active');

  const btn = document.querySelector(`.admin-tab-btn[onclick="switchAdminTab('${tab}')"]`);
  if (btn) btn.classList.add('active');

  if (tab === 'dashboard') {
    updateAdminDashboard();
  } else if (tab === 'requests') {
    renderAdminRequests();
  } else if (tab === 'visits') {
    renderAdminVisits();
  } else if (tab === 'pets') {
    renderAdminPets();
  }
}

async function updateAdminDashboard() {
  if (!currentUser) return;
  const ongId = currentUser.id;

  const { count: totalPets } = await sb
    .from('pets')
    .select('*', { count: 'exact', head: true })
    .eq('ong_id', ongId);

  const { data: ongRequests } = await sb
    .from('adoption_requests')
    .select('id, status, pets!inner(ong_id)')
    .eq('pets.ong_id', ongId);

  const pending = (ongRequests || []).filter(r => r.status === 'pending').length;
  const approved = (ongRequests || []).filter(r => r.status === 'approved').length;

  const { count: visitsCount } = await sb
    .from('visits')
    .select('id, adoption_requests!inner(pet_id, pets!inner(ong_id))', { count: 'exact', head: true })
    .eq('adoption_requests.pets.ong_id', ongId);

  document.getElementById('totalPets').textContent = totalPets || 0;
  document.getElementById('pendingRequests').textContent = pending;
  document.getElementById('approvedAdoptions').textContent = approved;
  document.getElementById('scheduledVisits').textContent = visitsCount || 0;
}

async function renderAdminPets() {
  if (!currentUser) return;
  const list = document.getElementById('petsList');
  list.innerHTML = '<p style="text-align:center; color:#999;">Carregando...</p>';

  const { data: pets, error } = await sb
    .from('pets')
    .select('*')
    .eq('ong_id', currentUser.id)
    .order('created_at', { ascending: false });

  if (error) {
    list.innerHTML = `<p style="text-align:center; color:#999;">Erro: ${error.message}</p>`;
    return;
  }

  if (!pets || pets.length === 0) {
    list.innerHTML = '<p style="text-align:center; color:#999;">Nenhum pet cadastrado ainda.</p>';
    return;
  }

  list.innerHTML = pets.map(pet => `
    <div style="background: var(--light-bg); padding: 1rem; border-radius: 12px; margin-bottom: 1rem; display:flex; justify-content:space-between; align-items:center;">
      <div>
        <strong>${pet.name}</strong> - ${pet.breed} ${pet.status === 'adopted' ? '<span style="color:#999;">(adotado)</span>' : ''}
        <p style="font-size:0.9rem; color:#666;">${pet.city}, PR</p>
      </div>
      <div style="display:flex; gap:0.5rem;">
        <button class="btn-secondary" onclick="openEditPetForm('${pet.id}')">Editar</button>
        <button class="btn-secondary" onclick="deletePet('${pet.id}')">Excluir</button>
      </div>
    </div>
  `).join('');
}

function openAddPetForm() {
  editingPetId = null;
  document.getElementById('petFormTitle').textContent = 'Adicionar Pet';
  document.getElementById('petFormName').value = '';
  document.getElementById('petFormType').value = 'dog';
  document.getElementById('petFormBreed').value = '';
  document.getElementById('petFormAge').value = '';
  document.getElementById('petFormSize').value = 'medium';
  document.getElementById('petFormEnergy').value = 'Moderada';
  document.getElementById('petFormCity').value = currentUser?.city || '';
  document.getElementById('petFormImage').value = '';
  document.getElementById('petFormModal').classList.add('active');
}

async function openEditPetForm(petId) {
  const { data: pet, error } = await sb.from('pets').select('*').eq('id', petId).single();
  if (error || !pet) {
    alert('Não foi possível carregar este pet.');
    return;
  }
  editingPetId = pet.id;
  document.getElementById('petFormTitle').textContent = 'Editar Pet';
  document.getElementById('petFormName').value = pet.name;
  document.getElementById('petFormType').value = pet.type;
  document.getElementById('petFormBreed').value = pet.breed;
  document.getElementById('petFormAge').value = pet.age;
  document.getElementById('petFormSize').value = pet.size;
  document.getElementById('petFormEnergy').value = pet.energy || 'Moderada';
  document.getElementById('petFormCity').value = pet.city;
  document.getElementById('petFormImage').value = '';
  document.getElementById('petFormModal').classList.add('active');
}

function closePetFormModal() {
  document.getElementById('petFormModal').classList.remove('active');
}

async function savePetForm(e) {
  e.preventDefault();
  if (!currentUser || currentUser.user_type !== 'ong') return;

  const name = document.getElementById('petFormName').value.trim();
  const type = document.getElementById('petFormType').value;
  const breed = document.getElementById('petFormBreed').value.trim();
  const age = parseInt(document.getElementById('petFormAge').value, 10);
  const size = document.getElementById('petFormSize').value;
  const energy = document.getElementById('petFormEnergy').value;
  const city = document.getElementById('petFormCity').value.trim();
  const imageFile = document.getElementById('petFormImage').files[0];

  if (!name || !breed || !city || isNaN(age) || age < 0) {
    alert('Preencha nome, raça, cidade e uma idade válida.');
    return;
  }

  const petData = { name, type, breed, age, size, energy, city, ong_id: currentUser.id };

  if (imageFile) {
    try {
      petData.image_url = await uploadFileToBucket('pet-images', imageFile, `pets/${currentUser.id}`);
    } catch (uploadError) {
      alert('Erro ao enviar imagem: ' + uploadError.message);
      return;
    }
  }

  let error;
  if (editingPetId) {
    ({ error } = await sb.from('pets').update(petData).eq('id', editingPetId));
  } else {
    ({ error } = await sb.from('pets').insert([petData]));
  }

  if (error) {
    alert('Erro ao salvar pet: ' + error.message);
    return;
  }

  closePetFormModal();
  renderAdminPets();
  updateAdminDashboard();
  alert('Pet salvo com sucesso!');
}

async function deletePet(petId) {
  if (!confirm('Tem certeza que deseja excluir este pet?')) return;

  const { error } = await sb.from('pets').delete().eq('id', petId);
  if (error) {
    alert('Erro ao excluir: ' + error.message);
    return;
  }
  renderAdminPets();
  updateAdminDashboard();
}

async function renderAdminRequests() {
  if (!currentUser) return;
  const list = document.getElementById('requestsListAdmin');
  list.innerHTML = '<p style="text-align:center; color:#999;">Carregando...</p>';

  const { data: requests, error } = await sb
    .from('adoption_requests')
    .select('id, status, adopter_id, pets!inner(name, ong_id)')
    .eq('pets.ong_id', currentUser.id)
    .order('created_at', { ascending: false });

  if (error) {
    list.innerHTML = `<p style="text-align:center; color:#999;">Erro: ${error.message}</p>`;
    return;
  }

  if (!requests || requests.length === 0) {
    list.innerHTML = '<p style="text-align:center; color:#999;">Nenhuma solicitação recebida ainda.</p>';
    return;
  }

  const adopterIds = [...new Set(requests.map(r => r.adopter_id))];
  const { data: adopters } = await sb.from('profiles').select('id, name').in('id', adopterIds);
  const adopterNameById = Object.fromEntries((adopters || []).map(a => [a.id, a.name]));

  list.innerHTML = requests.map(req => `
    <div style="background: var(--light-bg); padding: 1.5rem; border-radius: 12px; margin-bottom: 1rem;">
      <h4>${req.pets.name}</h4>
      <p><strong>Adotador:</strong> ${adopterNameById[req.adopter_id] || 'Desconhecido'}</p>
      <p><strong>Status:</strong> ${req.status}</p>
      <div style="display:flex; gap:0.5rem; margin-top:1rem;">
        ${req.status === 'pending' ? `
          <button class="btn-primary" onclick="approveRequest('${req.id}')">Aprovar</button>
          <button class="btn-secondary" onclick="rejectRequest('${req.id}')">Rejeitar</button>
        ` : req.status === 'approved' ? `
          <button class="btn-primary" onclick="scheduleVisit('${req.id}')">Agendar Visita</button>
        ` : ''}
      </div>
    </div>
  `).join('');
}

async function approveRequest(requestId) {
  const { error } = await sb.from('adoption_requests').update({ status: 'approved' }).eq('id', requestId);
  if (error) { alert('Erro ao aprovar: ' + error.message); return; }
  renderAdminRequests();
  updateAdminDashboard();
  alert('Solicitação aprovada!');
}

async function rejectRequest(requestId) {
  const { error } = await sb.from('adoption_requests').update({ status: 'rejected' }).eq('id', requestId);
  if (error) { alert('Erro ao rejeitar: ' + error.message); return; }
  renderAdminRequests();
  updateAdminDashboard();
  alert('Solicitação rejeitada!');
}

async function scheduleVisit(requestId) {
  const dateStr = prompt('Data e hora da visita (AAAA-MM-DD HH:MM):');
  if (!dateStr) return;

  const scheduledDate = new Date(dateStr.replace(' ', 'T'));
  if (isNaN(scheduledDate.getTime())) {
    alert('Data inválida. Use o formato AAAA-MM-DD HH:MM.');
    return;
  }

  const { error } = await sb.from('visits').insert([{
    request_id: requestId,
    scheduled_date: scheduledDate.toISOString()
  }]);

  if (error) {
    alert('Erro ao agendar visita: ' + error.message);
    return;
  }

  alert('Visita agendada com sucesso!');
  updateAdminDashboard();
}

async function renderAdminVisits() {
  if (!currentUser) return;
  const list = document.getElementById('visitsList');
  list.innerHTML = '<p style="text-align:center; color:#999;">Carregando...</p>';

  const { data: visits, error } = await sb
    .from('visits')
    .select('id, scheduled_date, notes, adoption_requests!inner(pet_id, pets!inner(name, ong_id))')
    .eq('adoption_requests.pets.ong_id', currentUser.id)
    .order('scheduled_date', { ascending: true });

  if (error) {
    list.innerHTML = `<p style="text-align:center; color:#999;">Erro: ${error.message}</p>`;
    return;
  }

  if (!visits || visits.length === 0) {
    list.innerHTML = '<p style="text-align:center; color:#999;">Nenhuma visita agendada.</p>';
    return;
  }

  list.innerHTML = visits.map(v => `
    <div style="background: var(--light-bg); padding: 1.5rem; border-radius: 12px; margin-bottom: 1rem;">
      <h4>${v.adoption_requests.pets.name}</h4>
      <p><strong>Data:</strong> ${new Date(v.scheduled_date).toLocaleString()}</p>
      ${v.notes ? `<p><strong>Notas:</strong> ${v.notes}</p>` : ''}
    </div>
  `).join('');
}
