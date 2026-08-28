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
  loadStats();
  startTestimonialAutoPlay();
  renderPets();
});

async function loadStats() {
  // As 4 "Histórias de Sucesso" em destaque na home já representam adoções e
  // famílias felizes reais — por isso somamos como ponto de partida em ambos
  // os números, e a partir daí eles crescem de verdade junto com o sistema.
  const FEATURED_SUCCESS_STORIES = 4;

  const { count: adoptedCount } = await sb
    .from('pets')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'adopted');

  const { count: availableCount } = await sb
    .from('pets')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'available');

  const { count: familiesCount } = await sb
    .from('adoption_requests')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'completed');

  const adopted = FEATURED_SUCCESS_STORIES + (adoptedCount || 0);
  const available = availableCount || 0;
  const families = FEATURED_SUCCESS_STORIES + (familiesCount || 0);

  document.getElementById('statFamilies').dataset.target = families;
  document.getElementById('statAdopted').dataset.target = adopted;
  document.getElementById('statAvailable').dataset.target = available;

  animateCounters();
}

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
    if (profile.is_blocked) {
      await sb.auth.signOut();
      alert('Sua conta foi bloqueada pela administração da plataforma.');
      return;
    }
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

  if (profile.is_blocked) {
    await sb.auth.signOut();
    alert('Sua conta foi bloqueada pela administração da plataforma. Entre em contato com o suporte para mais informações.');
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
  const btnNotifications = document.getElementById('btnNotifications');
  const ongAdminLink = document.getElementById('ongAdminLink');
  const adminPanelLink = document.getElementById('adminPanelLink');

  if (currentUser) {
    btnLogin.style.display = 'none';
    btnProfile.style.display = 'block';
    document.getElementById('userName').textContent = currentUser.name;

    adminPanelLink.style.display = currentUser.user_type === 'admin' ? 'block' : 'none';

    if (currentUser.user_type === 'ong') {
      ongAdminLink.style.display = 'block';
      btnNotifications.style.display = 'none';
    } else if (currentUser.user_type === 'admin') {
      ongAdminLink.style.display = 'none';
      btnNotifications.style.display = 'none';
    } else {
      ongAdminLink.style.display = 'none';
      btnNotifications.style.display = 'block';
      refreshNotificationBadge();
    }
  } else {
    btnLogin.style.display = 'block';
    btnProfile.style.display = 'none';
    btnNotifications.style.display = 'none';
    ongAdminLink.style.display = 'none';
    adminPanelLink.style.display = 'none';
  }
}

function toggleProfileMenu() {
  document.getElementById('notificationsMenu').style.display = 'none';
  const menu = document.getElementById('profileMenu');
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

// ============================================================================
// NOTIFICAÇÕES (etapas do processo de adoção)
// ============================================================================
async function refreshNotificationBadge() {
  if (!currentUser || currentUser.user_type !== 'adopter') return;

  const { count } = await sb
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('adopter_id', currentUser.id)
    .eq('is_read', false);

  const badge = document.getElementById('notificationBadge');
  if (count && count > 0) {
    badge.textContent = count > 9 ? '9+' : String(count);
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

async function toggleNotificationsMenu() {
  document.getElementById('profileMenu').style.display = 'none';
  const menu = document.getElementById('notificationsMenu');
  const opening = menu.style.display === 'none';
  menu.style.display = opening ? 'block' : 'none';
  if (opening) {
    await renderNotifications();
    await markAllNotificationsRead();
  }
}

async function renderNotifications() {
  const list = document.getElementById('notificationsList');
  const { data: notifications, error } = await sb
    .from('notifications')
    .select('id, message, is_read, created_at')
    .eq('adopter_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    list.innerHTML = `<p style="color:#999;">Erro ao carregar notificações.</p>`;
    return;
  }

  if (!notifications || notifications.length === 0) {
    list.innerHTML = '<p style="color:#999;">Nenhuma notificação.</p>';
    return;
  }

  list.innerHTML = notifications.map(n => `
    <div style="padding:0.6rem 0; border-bottom:1px solid rgba(255,255,255,0.15); ${n.is_read ? 'opacity:0.6;' : ''}">
      <p style="margin:0;">${n.message}</p>
      <span style="font-size:0.75rem; color:#999;">${new Date(n.created_at).toLocaleString()}</span>
    </div>
  `).join('');
}

async function markAllNotificationsRead() {
  await sb.from('notifications').update({ is_read: true }).eq('adopter_id', currentUser.id).eq('is_read', false);
  refreshNotificationBadge();
}

async function createNotification(requestId, message) {
  const { data: request } = await sb
    .from('adoption_requests')
    .select('adopter_id')
    .eq('id', requestId)
    .single();

  if (!request) return;

  const { error } = await sb.from('notifications').insert([{
    adopter_id: request.adopter_id,
    request_id: requestId,
    message
  }]);
  if (error) console.error('Erro ao criar notificação:', error.message);
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.btn-profile') && !e.target.closest('.profile-menu')) {
    document.getElementById('profileMenu').style.display = 'none';
    document.getElementById('notificationsMenu').style.display = 'none';
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
  } else if (page === 'admin-panel') {
    if (!currentUser || currentUser.user_type !== 'admin') {
      alert('Apenas administradores têm acesso a esse painel.');
      showPage('home');
      return;
    }
    renderAdminUsersList();
  } else if (page === 'two-factor') {
    if (!currentUser) {
      alert('Faça login para acessar a verificação em duas etapas.');
      showPage('home');
      return;
    }
    loadTwoFactorStatus();
  }

  window.scrollTo(0, 0);
}

// ===== CAROUSEL =====
function nextCarousel() {
  const total = document.querySelectorAll('.carousel-item').length;
  currentCarouselIndex = (currentCarouselIndex + 1) % total;
  updateCarousel();
}

function prevCarousel() {
  const total = document.querySelectorAll('.carousel-item').length;
  currentCarouselIndex = (currentCarouselIndex - 1 + total) % total;
  updateCarousel();
}

function updateCarousel() {
  const items = document.querySelectorAll('.carousel-item');
  items.forEach((item, i) => {
    item.classList.toggle('active', i === currentCarouselIndex);
  });
  document.getElementById('carouselIndicator').textContent = `${currentCarouselIndex + 1} / ${items.length}`;
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

  // Busca o nome das ONGs separadamente (evita ambiguidade de relação no Supabase)
  const ongIds = [...new Set(allPets.map(p => p.ong_id).filter(Boolean))];
  if (ongIds.length > 0) {
    const { data: ongs } = await sb.from('profiles').select('id, name').in('id', ongIds);
    const ongNameById = Object.fromEntries((ongs || []).map(o => [o.id, o.name]));
    allPets = allPets.map(pet => ({ ...pet, ongName: ongNameById[pet.ong_id] || 'ONG não identificada' }));
  }

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
  const favoritesOnly = document.getElementById('filterFavorites')?.checked;

  if (typeFilter) pets = pets.filter(p => p.type === typeFilter);
  if (sizeFilter) pets = pets.filter(p => p.size === sizeFilter);
  if (locationFilter) pets = pets.filter(p => p.city.toLowerCase().includes(locationFilter));
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
        <div class="pet-details">🏠 ${pet.ongName || 'ONG não identificada'}</div>
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
    ${pet.video_url ? `<video src="${pet.video_url}" controls style="width:100%; border-radius:12px; margin:0 0 1rem 0;"></video>` : ''}
    <div style="background: var(--light-bg); padding: 1rem; border-radius: 12px; margin: 1rem 0;">
      <p><strong>Raça:</strong> ${pet.breed}</p>
      <p><strong>Idade:</strong> ${pet.age} anos</p>
      <p><strong>Tamanho:</strong> ${pet.size}</p>
      <p><strong>Energia:</strong> ${pet.energy || 'Moderada'}</p>
      <p><strong>Localização:</strong> ${pet.city}, PR</p>
      <p><strong>ONG responsável:</strong> ${pet.ongName || 'Não identificada'}</p>
    </div>
    <div style="background: var(--light-bg); padding: 1rem; border-radius: 12px; margin: 1rem 0;">
      <h3 style="margin-top:0;">Saúde</h3>
      <p>${pet.vaccinated ? '✅' : '❌'} Vacinado &nbsp; ${pet.neutered ? '✅' : '❌'} Castrado &nbsp; ${pet.dewormed ? '✅' : '❌'} Vermifugado</p>
      ${pet.health_notes ? `<p><strong>Observações:</strong> ${pet.health_notes}</p>` : ''}
    </div>
    <div style="background: var(--light-bg); padding: 1rem; border-radius: 12px; margin: 1rem 0;">
      <h3 style="margin-top:0;">Comportamento</h3>
      <p>${pet.temperament || 'Ainda não informado pela ONG.'}</p>
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
      <p><strong>Data:</strong> ${new Date(req.created_at).toLocaleDateString()}</p>
      ${renderProgressBar(req.status)}
      <button class="btn-primary" style="margin-top:1rem;" onclick="showOngContact('${req.pets ? req.pets.ong_id : ''}')">Contato da ONG</button>
    </div>
  `).join('');
}

function renderProgressBar(status) {
  if (status === 'rejected') {
    return `<p style="color:#d33; font-weight:bold; margin-top:0.5rem;">❌ Solicitação rejeitada</p>`;
  }

  const steps = [
    { key: 'pending', label: 'Solicitado' },
    { key: 'approved', label: 'Aprovado' },
    { key: 'visit_scheduled', label: 'Visita agendada' },
    { key: 'completed', label: 'Adotado' }
  ];
  const order = ['pending', 'approved', 'visit_scheduled', 'completed'];
  const currentIndex = order.indexOf(status);

  return `
    <div style="display:flex; align-items:center; margin-top:1rem;">
      ${steps.map((step, i) => `
        <div style="flex:1; text-align:center;">
          <div style="width:28px; height:28px; border-radius:50%; margin:0 auto; display:flex; align-items:center; justify-content:center; font-size:0.8rem; font-weight:bold; color:#fff; background:${i <= currentIndex ? 'var(--primary-green)' : '#ccc'};">
            ${i < currentIndex ? '✓' : i + 1}
          </div>
          <div style="font-size:0.7rem; margin-top:0.25rem; color:${i <= currentIndex ? 'var(--dark-text)' : '#999'};">${step.label}</div>
        </div>
        ${i < steps.length - 1 ? `<div style="flex:1; height:3px; background:${i < currentIndex ? 'var(--primary-green)' : '#ccc'}; margin-bottom:1.2rem;"></div>` : ''}
      `).join('')}
    </div>
  `;
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
  document.getElementById('petFormVideo').value = '';
  document.getElementById('petFormVaccinated').checked = false;
  document.getElementById('petFormNeutered').checked = false;
  document.getElementById('petFormDewormed').checked = false;
  document.getElementById('petFormHealthNotes').value = '';
  document.getElementById('petFormTemperament').value = '';
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
  document.getElementById('petFormVideo').value = '';
  document.getElementById('petFormVaccinated').checked = !!pet.vaccinated;
  document.getElementById('petFormNeutered').checked = !!pet.neutered;
  document.getElementById('petFormDewormed').checked = !!pet.dewormed;
  document.getElementById('petFormHealthNotes').value = pet.health_notes || '';
  document.getElementById('petFormTemperament').value = pet.temperament || '';
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
  const videoFile = document.getElementById('petFormVideo').files[0];
  const vaccinated = document.getElementById('petFormVaccinated').checked;
  const neutered = document.getElementById('petFormNeutered').checked;
  const dewormed = document.getElementById('petFormDewormed').checked;
  const healthNotes = document.getElementById('petFormHealthNotes').value.trim();
  const temperament = document.getElementById('petFormTemperament').value.trim();

  if (!name || !breed || !city || isNaN(age) || age < 0) {
    alert('Preencha nome, raça, cidade e uma idade válida.');
    return;
  }

  const petData = {
    name, type, breed, age, size, energy, city, ong_id: currentUser.id,
    vaccinated, neutered, dewormed,
    health_notes: healthNotes, temperament
  };

  if (imageFile) {
    try {
      petData.image_url = await uploadFileToBucket('pet-images', imageFile, `pets/${currentUser.id}`);
    } catch (uploadError) {
      alert('Erro ao enviar imagem: ' + uploadError.message);
      return;
    }
  }

  if (videoFile) {
    try {
      petData.video_url = await uploadFileToBucket('pet-images', videoFile, `pet-videos/${currentUser.id}`);
    } catch (uploadError) {
      alert('Erro ao enviar vídeo: ' + uploadError.message);
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
        ` : req.status === 'visit_scheduled' ? `
          <button class="btn-primary" onclick="completeAdoption('${req.id}')">Concluir Adoção</button>
        ` : ''}
      </div>
    </div>
  `).join('');
}

async function approveRequest(requestId) {
  const { error } = await sb.from('adoption_requests').update({ status: 'approved' }).eq('id', requestId);
  if (error) { alert('Erro ao aprovar: ' + error.message); return; }
  await createNotification(requestId, 'Sua solicitação de adoção foi aprovada! A ONG vai agendar uma visita em breve.');
  renderAdminRequests();
  updateAdminDashboard();
  alert('Solicitação aprovada!');
}

async function rejectRequest(requestId) {
  const { error } = await sb.from('adoption_requests').update({ status: 'rejected' }).eq('id', requestId);
  if (error) { alert('Erro ao rejeitar: ' + error.message); return; }
  await createNotification(requestId, 'Sua solicitação de adoção não foi aprovada desta vez.');
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

  await sb.from('adoption_requests').update({ status: 'visit_scheduled' }).eq('id', requestId);
  await createNotification(requestId, `Uma visita foi agendada para ${scheduledDate.toLocaleString()}.`);

  alert('Visita agendada com sucesso!');
  renderAdminRequests();
  updateAdminDashboard();
}

async function completeAdoption(requestId) {
  if (!confirm('Confirmar que a adoção foi concluída?')) return;

  const { data: request, error: fetchError } = await sb
    .from('adoption_requests')
    .select('pet_id')
    .eq('id', requestId)
    .single();

  if (fetchError || !request) {
    alert('Não foi possível localizar essa solicitação.');
    return;
  }

  const { error: reqError } = await sb.from('adoption_requests').update({ status: 'completed' }).eq('id', requestId);
  if (reqError) { alert('Erro ao concluir: ' + reqError.message); return; }

  await sb.from('pets').update({ status: 'adopted' }).eq('id', request.pet_id);
  await createNotification(requestId, 'Parabéns! Sua adoção foi concluída. 🎉');

  renderAdminRequests();
  renderAdminPets();
  updateAdminDashboard();
  alert('Adoção concluída com sucesso!');
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

// ============================================================================
// CHAT DE SUPORTE (perguntas frequentes, sem custo, sem API externa)
// ============================================================================
const SUPPORT_KNOWLEDGE_BASE = [
  {
    keywords: ['adotar', 'adoção', 'adocao', 'como funciona a adoção', 'processo de adoção'],
    question: 'Como funciona o processo de adoção?',
    answer: 'É simples: você encontra o pet na aba "Pets", clica em "Detalhes" e depois em "Quero Adotar!". A ONG responsável recebe sua solicitação, pode aprovar, agendar uma visita e, por fim, concluir a adoção. Você acompanha tudo pela barra de progresso em "Minhas Solicitações".'
  },
  {
    keywords: ['cadastrar ong', 'sou uma ong', 'cadastro de ong', 'criar conta ong', 'abrigo'],
    question: 'Como cadastrar minha ONG?',
    answer: 'Clique em "Entrar" no topo da página, escolha a opção "ONG" e preencha o formulário de cadastro com nome, e-mail, telefone, endereço e cidade. Depois disso você já tem acesso ao Painel Administrativo.'
  },
  {
    keywords: ['adicionar pet', 'cadastrar pet', 'colocar pet para adoção', 'novo pet'],
    question: 'Como adicionar um pet para adoção?',
    answer: 'Entre com sua conta de ONG, vá em "Painel ONG" → aba "Pets" → botão "Adicionar Pet". Preencha nome, tipo, raça, idade, tamanho, cidade, informações de saúde/comportamento e, se quiser, uma foto e um vídeo.'
  },
  {
    keywords: ['favoritar', 'favorito', 'coração', 'salvar pet'],
    question: 'Como favoritar um pet?',
    answer: 'Na lista de pets, clique no coração 🤍 no card do animal. Ele fica salvo nos seus favoritos, e você pode filtrar só os favoritos marcando "Apenas Favoritos" nos filtros.'
  },
  {
    keywords: ['notificação', 'notificacao', 'sino', 'aviso'],
    question: 'Como funcionam as notificações?',
    answer: 'O sininho 🔔 no topo da página avisa quando sua solicitação de adoção muda de status — por exemplo, quando é aprovada, quando uma visita é agendada ou quando a adoção é concluída.'
  },
  {
    keywords: ['perfil', 'editar dados', 'meus dados', 'foto de perfil'],
    question: 'Como edito meu perfil?',
    answer: 'Clique no seu nome no topo da página → "Meu Perfil". Lá você pode atualizar telefone, endereço, cidade e enviar foto de perfil e fotos/vídeos da sua residência.'
  },
  {
    keywords: ['senha', 'esqueci', 'recuperar acesso', 'não consigo entrar'],
    question: 'Esqueci minha senha, e agora?',
    answer: 'No momento o site ainda não tem recuperação automática de senha. Entre em contato diretamente com a equipe do PetMatch para receber ajuda com o acesso à sua conta.'
  },
  {
    keywords: ['gratuito', 'grátis', 'custa', 'preço', 'pagar'],
    question: 'O PetMatch é gratuito?',
    answer: 'Sim! Usar o PetMatch para adotar ou para cadastrar pets como ONG é totalmente gratuito.'
  },
  {
    keywords: ['visita', 'agendar visita', 'quando é a visita'],
    question: 'Como funciona a visita?',
    answer: 'Depois que sua solicitação é aprovada, a ONG agenda uma data para você conhecer o pet pessoalmente. Você recebe uma notificação assim que a visita for marcada.'
  },
  {
    keywords: ['contato', 'falar com a ong', 'telefone da ong'],
    question: 'Como falo com a ONG responsável pelo pet?',
    answer: 'Em "Minhas Solicitações", clique no botão "Contato da ONG" dentro do card da sua solicitação — vai aparecer nome, e-mail, telefone e endereço da ONG.'
  }
];

const SUPPORT_SUGGESTIONS = [
  'Como funciona a adoção?',
  'Como cadastrar minha ONG?',
  'Como favoritar um pet?',
  'O PetMatch é gratuito?'
];

let supportChatStarted = false;

function toggleSupportChat() {
  const win = document.getElementById('supportChatWindow');
  const opening = !win.classList.contains('active');
  win.classList.toggle('active', opening);

  if (opening && !supportChatStarted) {
    supportChatStarted = true;
    addSupportMessage('bot', 'Oi! 👋 Eu sou o assistente virtual do PetMatch. Posso te ajudar com dúvidas sobre adoção, cadastro de pets, favoritos e mais. Pode perguntar!');
    renderSupportSuggestions();
  }

  if (opening) {
    document.getElementById('supportChatInput').focus();
  }
}

function renderSupportSuggestions() {
  const box = document.getElementById('supportChatSuggestions');
  box.innerHTML = SUPPORT_SUGGESTIONS.map(s => `
    <button type="button" onclick="askSupportSuggestion('${s.replace(/'/g, "\\'")}')">${s}</button>
  `).join('');
}

function askSupportSuggestion(text) {
  document.getElementById('supportChatInput').value = text;
  handleSupportChatSubmit(new Event('submit'));
}

function handleSupportChatSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('supportChatInput');
  const text = input.value.trim();
  if (!text) return;

  addSupportMessage('user', text);
  input.value = '';

  setTimeout(() => {
    const answer = findSupportAnswer(text);
    addSupportMessage('bot', answer);
  }, 400);
}

function findSupportAnswer(userText) {
  const normalized = userText.toLowerCase();
  let bestMatch = null;
  let bestScore = 0;

  SUPPORT_KNOWLEDGE_BASE.forEach(entry => {
    let score = 0;
    entry.keywords.forEach(keyword => {
      if (normalized.includes(keyword)) score += keyword.length;
    });
    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  });

  if (bestMatch) return bestMatch.answer;

  return 'Não tenho certeza sobre isso ainda. 🐾 Você pode reformular a pergunta, ou, se preferir, falar direto com a ONG responsável pelo pet através da tela "Minhas Solicitações".';
}

function addSupportMessage(sender, text) {
  const messages = document.getElementById('supportChatMessages');
  const bubble = document.createElement('div');
  bubble.className = `support-chat-bubble ${sender}`;
  bubble.textContent = text;
  messages.appendChild(bubble);
  messages.scrollTop = messages.scrollHeight;
}

// ============================================================================
// PAINEL ADM (verificar, bloquear e excluir usuários)
// ============================================================================
async function renderAdminUsersList() {
  const container = document.getElementById('adminUsersList');
  container.innerHTML = '<p style="text-align:center; color:#999;">Carregando usuários...</p>';

  const { data: users, error } = await sb
    .from('profiles')
    .select('*')
    .neq('user_type', 'admin')
    .order('created_at', { ascending: false });

  if (error) {
    container.innerHTML = `<p style="text-align:center; color:#999;">Erro ao carregar usuários: ${error.message}</p>`;
    return;
  }

  if (!users || users.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:#999;">Nenhum usuário cadastrado ainda.</p>';
    return;
  }

  container.innerHTML = users.map(u => `
    <div style="background: var(--light-bg); padding: 1rem 1.2rem; border-radius: 12px; margin-bottom: 1rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem;">
      <div>
        <strong>${u.name}</strong>
        <span style="background:${u.user_type === 'ong' ? 'var(--primary-green)' : 'var(--primary-blue)'}; color:#fff; font-size:0.7rem; padding:2px 8px; border-radius:999px; margin-left:0.5rem;">${u.user_type === 'ong' ? 'ONG' : 'Adotador'}</span>
        ${u.is_verified ? '<span style="color: var(--primary-green); font-size:0.8rem; margin-left:0.5rem;">✔ Verificado</span>' : ''}
        ${u.is_blocked ? '<span style="color:#d33; font-size:0.8rem; margin-left:0.5rem;">🚫 Bloqueado</span>' : ''}
        <p style="font-size:0.85rem; color:#666; margin:0.25rem 0 0 0;">${u.email}${u.city ? ' • ' + u.city : ''}</p>
      </div>
      <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
        <button class="btn-secondary" onclick="adminToggleVerified('${u.id}', ${!u.is_verified})">${u.is_verified ? 'Remover verificação' : 'Verificar'}</button>
        <button class="btn-secondary" onclick="adminToggleBlocked('${u.id}', ${!u.is_blocked})">${u.is_blocked ? 'Desbloquear' : 'Bloquear'}</button>
        <button class="btn-secondary" onclick="adminDeleteUser('${u.id}', '${u.name.replace(/'/g, "\\'")}')">Excluir</button>
      </div>
    </div>
  `).join('');
}

async function adminToggleVerified(userId, newValue) {
  const { error } = await sb.from('profiles').update({ is_verified: newValue }).eq('id', userId);
  if (error) { alert('Erro ao atualizar verificação: ' + error.message); return; }
  renderAdminUsersList();
}

async function adminToggleBlocked(userId, newValue) {
  const { error } = await sb.from('profiles').update({ is_blocked: newValue }).eq('id', userId);
  if (error) { alert('Erro ao atualizar bloqueio: ' + error.message); return; }
  renderAdminUsersList();
}

async function adminDeleteUser(userId, userName) {
  const confirmed = confirm(
    `Excluir "${userName}"? Isso remove o perfil e todos os dados vinculados (pets, solicitações, favoritos).\n\n` +
    `Observação: o login (e-mail/senha) dessa pessoa continuará existindo no sistema de autenticação — ` +
    `para remover totalmente o acesso, é necessário excluir também pelo painel do Supabase (Authentication > Users).`
  );
  if (!confirmed) return;

  const { error } = await sb.from('profiles').delete().eq('id', userId);
  if (error) { alert('Erro ao excluir usuário: ' + error.message); return; }
  renderAdminUsersList();
}

// ============================================================================
// VERIFICAÇÃO EM DUAS ETAPAS (demonstração acadêmica — sem envio real de SMS)
// ============================================================================
let pendingVerificationCode = null;

function loadTwoFactorStatus() {
  const statusBox = document.getElementById('twoFactorStatus');
  const verified = currentUser.two_factor_verified;

  statusBox.innerHTML = verified
    ? `<p style="color: var(--primary-green); font-weight:bold; margin:0;">✔ Conta verificada em duas etapas</p>`
    : `<p style="color:#d97706; font-weight:bold; margin:0;">⚠ Conta ainda não verificada</p>`;

  document.getElementById('twoFactorPhone').value = currentUser.phone || '';
  document.getElementById('verificationCodeBox').style.display = 'none';
  document.getElementById('verificationCodeInput').value = '';
}

async function sendVerificationCode() {
  const phone = document.getElementById('twoFactorPhone').value.trim();

  if (!phone) {
    alert('Informe um telefone para receber o código.');
    return;
  }

  // Salva o telefone informado no perfil, caso ainda não estivesse cadastrado
  await sb.from('profiles').update({ phone }).eq('id', currentUser.id);
  currentUser.phone = phone;

  pendingVerificationCode = String(Math.floor(100000 + Math.random() * 900000));

  // DEMONSTRAÇÃO ACADÊMICA: sem um serviço de SMS pago (ex.: Twilio) configurado,
  // não há envio real. O código é exibido aqui para simular o recebimento.
  alert(
    `📧 Código enviado para o e-mail: ${currentUser.email}\n` +
    `📱 Código enviado por SMS para: ${phone}\n\n` +
    `(Simulação para fins acadêmicos — código: ${pendingVerificationCode})`
  );

  document.getElementById('verificationCodeBox').style.display = 'block';
}

async function confirmVerificationCode() {
  const typed = document.getElementById('verificationCodeInput').value.trim();

  if (!pendingVerificationCode) {
    alert('Clique em "Enviar Código de Verificação" primeiro.');
    return;
  }

  if (typed !== pendingVerificationCode) {
    alert('Código incorreto. Tente novamente.');
    return;
  }

  const { error } = await sb.from('profiles').update({ two_factor_verified: true }).eq('id', currentUser.id);
  if (error) {
    alert('Erro ao confirmar verificação: ' + error.message);
    return;
  }

  currentUser.two_factor_verified = true;
  pendingVerificationCode = null;
  loadTwoFactorStatus();
  alert('Conta verificada com sucesso! ✔');
}
