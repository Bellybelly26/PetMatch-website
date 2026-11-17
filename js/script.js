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
  restoreSession().then(renderLgpdBanner);
  loadAds();
  showPage('home');
  loadStats();
  startTestimonialAutoPlay();
  renderPets();
});

async function loadStats() {
  // As 4 "Histórias de Sucesso" (página Sobre) já representam adoções e
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

// Link de recuperação de senha (o Supabase coloca type=recovery no endereço)
let recoveryPending = /type=recovery/.test(location.hash || '');

async function restoreSession() {
  if (recoveryPending) return;
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
    await afterAuth();
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

  showSignupFor(type);
  switchAuthTab('login');
}

const ORG_SIGNUP_TEXT = {
  prefeitura: { label: 'Nome da prefeitura', hint: 'Conta da prefeitura: publique campanhas (como castração gratuita) e veja as ONGs da sua cidade. A conta passa por verificação da equipe.' },
  empresa: { label: 'Nome da empresa', hint: 'Conta de empresa: apareça em Parceiros perto de quem adota e venda na lojinha. O conteúdo passa por aprovação da equipe.' }
};

function showSignupFor(type) {
  document.getElementById('adopterSignupForm').style.display = (type === 'ong' || ORG_SIGNUP_TEXT[type]) ? 'none' : 'block';
  document.getElementById('ongSignupForm').style.display = type === 'ong' ? 'block' : 'none';
  const org = document.getElementById('orgSignupForm');
  org.style.display = ORG_SIGNUP_TEXT[type] ? 'block' : 'none';
  if (ORG_SIGNUP_TEXT[type]) {
    document.getElementById('orgNameLabel').textContent = ORG_SIGNUP_TEXT[type].label;
    document.getElementById('orgName').placeholder = ORG_SIGNUP_TEXT[type].label;
    document.getElementById('orgSignupHint').textContent = ORG_SIGNUP_TEXT[type].hint;
  }
}

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.auth-tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('auth-' + tab).classList.add('active');
  document.querySelector(`[onclick="switchAuthTab('${tab}')"]`).classList.add('active');

  if (tab === 'signup') {
    showSignupFor(document.getElementById('authTabs')?.dataset.type || 'adopter');
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
  await afterAuth();
  showPage('home');
  logClientEvent('login');
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

  if (!document.getElementById('signupConsent').checked) {
    alert('Para se cadastrar, aceite a Política de Privacidade (LGPD).');
    return;
  }

  // name/user_type vão em options.data (user_metadata); o trigger
  // on_auth_user_created (supabase-auth-trigger.sql) usa esses dados
  // para criar a linha em public.profiles automaticamente.
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { name, user_type: 'adopter', lgpd_consent: 'true' } }
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

  currentUser = { id: data.user.id, email, name, user_type: 'adopter', plan: 'free', lgpd_consent_at: new Date().toISOString() };
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

  if (!document.getElementById('ongConsent').checked) {
    alert('Para cadastrar a ONG, aceite a Política de Privacidade (LGPD).');
    return;
  }

  // Mesma lógica do adotador: os dados vão em options.data e o trigger
  // cria a linha em public.profiles automaticamente.
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { name, user_type: 'ong', phone, address, city, lgpd_consent: 'true' } }
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

  currentUser = { id: data.user.id, email, name, user_type: 'ong', phone, address, city, plan: 'free', lgpd_consent_at: new Date().toISOString() };
  closeAuthModal();
  updateHeader();
  showPage('ong-admin');
  alert(`ONG cadastrada com sucesso, ${name}!`);
}

async function handleOrgSignup() {
  const type = document.getElementById('authTabs')?.dataset.type;
  if (!ORG_SIGNUP_TEXT[type]) return;
  const name = document.getElementById('orgName').value.trim();
  const email = document.getElementById('orgEmail').value.trim();
  const phone = document.getElementById('orgPhone').value.trim();
  const address = document.getElementById('orgAddress').value.trim();
  const city = document.getElementById('orgCity').value.trim();
  const password = document.getElementById('orgPassword').value;

  if (!validateAuthFields({ Nome: name, Email: email, Cidade: city, Senha: password })) return;
  if (!isValidEmail(email)) { alert('Digite um e-mail válido.'); return; }
  if (password.length < 6) { alert('A senha deve ter pelo menos 6 caracteres.'); return; }
  if (!document.getElementById('orgConsent').checked) {
    alert('Para se cadastrar, aceite a Política de Privacidade (LGPD).');
    return;
  }

  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { data: { name, user_type: type, phone, address, city, lgpd_consent: 'true' } }
  });
  if (error) { alert('Erro ao cadastrar: ' + error.message); return; }

  if (!data.session) {
    closeAuthModal();
    alert(`Cadastro realizado, ${name}! Verifique o e-mail para confirmar a conta antes de entrar.`);
    return;
  }

  currentUser = { id: data.user.id, email, name, user_type: type, phone, address, city, plan: 'free', lgpd_consent_at: new Date().toISOString() };
  closeAuthModal();
  updateHeader();
  showPage('org-panel');
  alert(`Cadastro realizado com sucesso, ${name}! Seu conteúdo será publicado depois da aprovação da equipe.`);
}

async function logout() {
  await logClientEvent('logout');
  await sb.auth.signOut();
  currentUser = null;
  updateHeader();
  showPage('home');
  document.getElementById('profileMenu').style.display = 'none';
  alert('Você foi desconectado!');
}

function getRoleLabel(userType) {
  const labels = {
    admin: 'Administrador',
    supervisor: 'Supervisor',
    ong: 'Usuário · ONG',
    adopter: 'Usuário · Adotador',
    prefeitura: 'Usuário · Prefeitura',
    empresa: 'Usuário · Empresa'
  };
  return labels[userType] || 'Usuário';
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

    const isStaff = currentUser.user_type === 'admin' || currentUser.user_type === 'supervisor';
    adminPanelLink.style.display = isStaff ? 'block' : 'none';
    adminPanelLink.textContent = currentUser.user_type === 'admin' ? 'Painel ADM' : 'Painel do Supervisor';
    const roleLabel = document.getElementById('profileRoleLabel');
    if (roleLabel) {
      roleLabel.textContent = '🏷️ ' + getRoleLabel(currentUser.user_type);
    }
    const role = currentUser.user_type;
    const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? 'block' : 'none'; };
    show('myRequestsLink', role === 'adopter');
    show('myPetsLink', role === 'adopter');
    show('compatLink', role === 'adopter');
    show('myPlanLink', ['adopter', 'ong', 'empresa', 'prefeitura'].includes(role));
    show('orgPanelLink', role === 'prefeitura' || role === 'empresa');
    const orgLink = document.getElementById('orgPanelLink');
    if (orgLink) orgLink.textContent = role === 'prefeitura' ? 'Painel da Prefeitura' : 'Painel da Empresa';

    if (currentUser.user_type === 'ong') {
      ongAdminLink.style.display = 'block';
      btnNotifications.style.display = 'none';
    } else if (currentUser.user_type !== 'adopter') {
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
  renderLgpdBanner();
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

  if (page === 'home' || page === 'pets' || page === 'partners') loadAds();
  if (page === 'pets') {
    renderPets();
  } else if (page === 'partners') {
    loadPartnersPage();
  } else if (page === 'shop') {
    loadShopPage();
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
    if (!currentUser || !['admin', 'supervisor'].includes(currentUser.user_type)) {
      alert('Apenas Administradores e Supervisores têm acesso a esse painel.');
      showPage('home');
      return;
    }
    const logsBtn = document.getElementById('staffTabBtn-logs');
    if (logsBtn) logsBtn.style.display = currentUser.user_type === 'admin' ? '' : 'none';
    switchStaffTab('users');
  } else if (page === 'org-panel') {
    if (!currentUser || !['prefeitura', 'empresa'].includes(currentUser.user_type)) {
      alert('Este painel é para Prefeituras e Empresas.');
      showPage('home');
      return;
    }
    loadOrgPanel();
  } else if (page === 'compat') {
    if (!currentUser || currentUser.user_type !== 'adopter') {
      alert('Faça login como adotador para ver a compatibilidade.');
      showPage('home');
      return;
    }
    loadCompatForm();
  } else if (page === 'help') {
    loadHelpPage();
  } else if (page === 'lgpd') {
    if (!currentUser) {
      alert('Faça login para acessar os seus dados.');
      showPage('home');
      return;
    }
    loadLgpdPage();
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
    const ongById = Object.fromEntries((ongs || []).map(o => [o.id, o]));
    allPets = allPets.map(pet => {
      const ong = ongById[pet.ong_id];
      return { ...pet, ongName: ong ? ong.name : 'ONG não identificada' };
    });
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
  renderHomePets();
  const grid = document.getElementById('petsGrid');
  grid.innerHTML = '';

  let pets = [...allPets];

  const typeFilter = document.getElementById('filterType')?.value;
  const sizeFilter = document.getElementById('filterSize')?.value;
  const locationFilter = document.getElementById('filterLocation')?.value.toLowerCase();
  const cepFilter = normCep(document.getElementById('filterCep')?.value);
  const favoritesOnly = document.getElementById('filterFavorites')?.checked;

  if (typeFilter) pets = pets.filter(p => p.type === typeFilter);
  if (sizeFilter) pets = pets.filter(p => p.size === sizeFilter);
  if (locationFilter) pets = pets.filter(p => p.city.toLowerCase().includes(locationFilter));
  if (cepFilter) pets = pets.filter(p => (p.cep || '').startsWith(cepFilter));
  if (favoritesOnly) pets = pets.filter(p => myFavoritePetIds.includes(p.id));

  // Se o adotador pediu, mostra primeiro os mais compatíveis
  if (document.getElementById('filterCompat')?.checked) {
    pets = pets.map((p, i) => ({ p, i })).sort((a, b) => {
      const ca = petCompat(a.p), cb = petCompat(b.p);
      return ((cb ? cb.score : -1) - (ca ? ca.score : -1)) || (a.i - b.i);
    }).map(x => x.p);
  }
  const compatGroup = document.getElementById('filterCompatGroup');
  if (compatGroup) compatGroup.style.display = hasMatchPrefs() ? '' : 'none';

  if (pets.length === 0) {
    grid.innerHTML = '<p style="text-align:center; color:#999; grid-column: 1 / -1;">Nenhum pet encontrado.</p>';
    return;
  }

  pets.forEach(pet => grid.appendChild(buildPetCard(pet)));
}

function buildPetCard(pet) {
  const isFavorite = myFavoritePetIds.includes(pet.id);
  const card = document.createElement('div');
  card.className = 'pet-card';
  const compat = petCompat(pet);
  const badges = [
    compat ? `<span class="pet-badge pet-badge-compat">💚 ${compat.score}% compatível</span>` : ''
  ].join('');
  card.innerHTML = `
    <img src="${escapeHtml(pet.image_url || 'images/pet-dog-brown-1.png')}" alt="${escapeHtml(pet.name)}" class="pet-image">
    <div class="pet-info">
      ${badges ? `<div class="pet-badges">${badges}</div>` : ''}
      <div class="pet-name">${escapeHtml(pet.name)}</div>
      <div class="pet-details">${escapeHtml(pet.breed)}</div>
      <div class="pet-details">${escapeHtml(pet.age)} anos • ${escapeHtml(pet.size)}</div>
      <div class="pet-details">📍 ${escapeHtml(pet.city)}${pet.cep ? ' • CEP ' + escapeHtml(formatCep(pet.cep)) : ''}</div>
      <div class="pet-details">🏠 ${escapeHtml(pet.ongName || 'ONG não identificada')}</div>
      <div class="pet-actions">
        <button class="btn-favorite ${isFavorite ? 'active' : ''}" onclick="toggleFavorite('${pet.id}')">
          ${isFavorite ? '❤️' : '🤍'}
        </button>
        <button class="btn-adopt" onclick="openPetDetail('${pet.id}')">Detalhes</button>
      </div>
    </div>
  `;
  return card;
}

// Página inicial: mostra os primeiros pets disponíveis (mesmos dados da página "Pets")
function renderHomePets() {
  const grid = document.getElementById('homePetsGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const pets = allPets.slice(0, 6);
  if (pets.length === 0) {
    grid.innerHTML = '<p style="text-align:center; color:#999; grid-column: 1 / -1;">Nenhum pet disponível no momento.</p>';
    return;
  }
  pets.forEach(pet => grid.appendChild(buildPetCard(pet)));
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
      <p><strong>Localização:</strong> ${pet.city}, PR${pet.cep ? ' • CEP ' + escapeHtml(formatCep(pet.cep)) : ''}</p>
      <p><strong>ONG responsável:</strong> ${escapeHtml(pet.ongName || 'Não identificada')}</p>
    </div>
    ${compatDetailHtml(pet)}
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
  document.getElementById('adopterCep').value = formatCep(currentUser.cep);
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
  const cep = normCep(document.getElementById('adopterCep').value);

  if (cep && cep.length !== 8) {
    alert('O CEP deve ter 8 números (ex.: 80010-000).');
    return;
  }
  if (!name || !email) {
    alert('Nome e e-mail são obrigatórios.');
    return;
  }
  if (!isValidEmail(email)) {
    alert('Digite um e-mail válido.');
    return;
  }

  const updates = { name, email, phone, address, city, cep: cep || null };

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
    list.innerHTML = `<p style="text-align:center; color:#999;">Erro ao carregar solicitações: ${escapeHtml(error.message)}</p>`;
    return;
  }

  if (!requests || requests.length === 0) {
    list.innerHTML = '<p style="text-align:center; color:#999;">Você ainda não fez nenhuma solicitação.</p>';
    return;
  }

  list.innerHTML = requests.map(req => {
    const petName = req.pets ? req.pets.name : 'Pet removido';
    return `
    <div style="background: var(--light-bg); padding: 1.5rem; border-radius: 12px; margin-bottom: 1rem; border-left: 4px solid var(--primary-blue);">
      <h3>${escapeHtml(petName)}</h3>
      <p><strong>Status:</strong> ${escapeHtml(STATUS_LABELS[req.status] || req.status)}</p>
      <p><strong>Data:</strong> ${new Date(req.created_at).toLocaleDateString('pt-BR')}</p>
      ${renderProgressBar(req.status)}
      <div style="display:flex; gap:0.5rem; margin-top:1rem; flex-wrap:wrap;">
        <button class="btn-primary" onclick="showOngContact('${req.pets ? req.pets.ong_id : ''}')">Contato da ONG</button>
        <button class="btn-secondary" onclick="showRequestHistory('${req.id}', ${jsStr(petName)})">Ver histórico</button>
        <button class="btn-secondary" onclick="openRequestChat('${req.id}', ${jsStr(petName)}, 'adopter')">💬 Mensagens</button>
      </div>
    </div>`;
  }).join('');
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
  document.getElementById('petFormCep').value = formatCep(currentUser?.cep);
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
  document.getElementById('petFormCep').value = formatCep(pet.cep);
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
  const cep = normCep(document.getElementById('petFormCep').value);
  if (cep && cep.length !== 8) {
    alert('O CEP deve ter 8 números (ex.: 80010-000).');
    return;
  }
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
    name, type, breed, age, size, energy, city, cep: cep || null, ong_id: currentUser.id,
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
    list.innerHTML = `<p style="text-align:center; color:#999;">Erro: ${escapeHtml(error.message)}</p>`;
    return;
  }

  if (!requests || requests.length === 0) {
    list.innerHTML = '<p style="text-align:center; color:#999;">Nenhuma solicitação recebida ainda.</p>';
    return;
  }

  const adopterIds = [...new Set(requests.map(r => r.adopter_id))];
  const { data: adopters } = await sb.from('profiles').select('id, name, email, phone, city, is_verified').in('id', adopterIds);
  const adopterById = Object.fromEntries((adopters || []).map(a => [a.id, a]));

  list.innerHTML = requests.map(req => {
    const a = adopterById[req.adopter_id] || {};
    return `
    <div style="background: var(--light-bg); padding: 1.5rem; border-radius: 12px; margin-bottom: 1rem;">
      <h4>${escapeHtml(req.pets.name)}</h4>
      <p><strong>Adotador:</strong> ${escapeHtml(a.name || 'Desconhecido')}${a.is_verified ? ' <span style="color: var(--primary-green); font-size:0.8rem;">✔ Verificado</span>' : ''}</p>
      <p><strong>E-mail:</strong> ${escapeHtml(a.email || '—')}</p>
      <p><strong>Telefone:</strong> ${escapeHtml(a.phone || 'Não informado')}</p>
      <p><strong>Cidade:</strong> ${escapeHtml(a.city || 'Não informada')}</p>
      <p><strong>Status:</strong> ${escapeHtml(STATUS_LABELS[req.status] || req.status)}</p>
      <div style="display:flex; gap:0.5rem; margin-top:1rem; flex-wrap:wrap;">
        <button class="btn-secondary" onclick="showProfileDetails('${req.adopter_id}')">Ver perfil completo</button>
        <button class="btn-secondary" onclick="showRequestHistory('${req.id}', ${jsStr(req.pets.name)})">Ver histórico</button>
        ${req.status === 'pending' ? `
          <button class="btn-primary" onclick="approveRequest('${req.id}')">Aprovar</button>
          <button class="btn-secondary" onclick="rejectRequest('${req.id}')">Rejeitar</button>
        ` : req.status === 'approved' ? `
          <button class="btn-primary" onclick="scheduleVisit('${req.id}')">Agendar Visita</button>
        ` : req.status === 'visit_scheduled' ? `
          <button class="btn-primary" onclick="completeAdoption('${req.id}')">Concluir Adoção</button>
        ` : ''}
      </div>
    </div>`;
  }).join('');
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

  const visitRow = { request_id: requestId, scheduled_date: scheduledDate.toISOString() };
  const { error } = await sb.from('visits').insert([visitRow]);

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
      <h4>${escapeHtml(v.adoption_requests.pets.name)}</h4>
      <p><strong>Data:</strong> ${new Date(v.scheduled_date).toLocaleString()}</p>
      ${v.notes ? `<p><strong>Notas:</strong> ${escapeHtml(v.notes)}</p>` : ''}
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
    answer: 'Na tela de login, clique em "Esqueci minha senha", digite o e-mail da conta e enviaremos um link para criar uma nova senha. Se o e-mail não chegar, olhe a caixa de spam. Se você não lembra qual e-mail usou ou não tem mais acesso a ele, fale com a equipe pelo e-mail contato@petmatch.com informando seu nome e cidade.'
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
  const isAdmin = currentUser && currentUser.user_type === 'admin';
  const titleEl = document.getElementById('adminPanelTitle');
  const subEl = document.getElementById('adminPanelSubtitle');
  if (titleEl) titleEl.textContent = isAdmin ? 'Painel Administrativo - Administrador' : 'Painel do Supervisor';
  if (subEl) subEl.textContent = isAdmin
    ? 'Controle total: verifique, bloqueie e exclua contas, e promova usuários a Supervisor.'
    : 'Modere as contas de Usuários (adotadores e ONGs): verifique e bloqueie/desbloqueie.';

  container.innerHTML = '<p style="text-align:center; color:#999;">Carregando usuários...</p>';

  let query = sb.from('profiles').select('*').order('created_at', { ascending: false });
  query = isAdmin
    ? query.neq('user_type', 'admin')
    : query.in('user_type', ['adopter', 'ong', 'prefeitura', 'empresa']);
  const { data: users, error } = await query;

  if (error) {
    container.innerHTML = `<p style="text-align:center; color:#999;">Erro ao carregar usuários: ${escapeHtml(error.message)}</p>`;
    return;
  }

  if (!users || users.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:#999;">Nenhum usuário cadastrado ainda.</p>';
    return;
  }

  const badgeColor = { ong: 'var(--primary-green)', adopter: 'var(--primary-blue)', supervisor: '#8e44ad', prefeitura: '#d9822b', empresa: '#16a085' };

  container.innerHTML = users.map(u => {
    const isSup = u.user_type === 'supervisor';
    const safeName = encodeURIComponent(u.name || '').replace(/'/g, '%27');
    return `
    <div style="background: var(--light-bg); padding: 1rem 1.2rem; border-radius: 12px; margin-bottom: 1rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem;">
      <div>
        <strong>${escapeHtml(u.name)}</strong>
        <span style="background:${badgeColor[u.user_type] || '#999'}; color:#fff; font-size:0.7rem; padding:2px 8px; border-radius:999px; margin-left:0.5rem;">${escapeHtml(getRoleLabel(u.user_type))}</span>
        ${u.is_verified ? '<span style="color: var(--primary-green); font-size:0.8rem; margin-left:0.5rem;">✔ Verificado</span>' : ''}
        ${u.is_blocked ? '<span style="color:#d33; font-size:0.8rem; margin-left:0.5rem;">🚫 Bloqueado</span>' : ''}
        <p style="font-size:0.85rem; color:#666; margin:0.25rem 0 0 0;">${escapeHtml(u.email)}${u.city ? ' • ' + escapeHtml(u.city) : ''}</p>
      </div>
      <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
        <button class="btn-secondary" onclick="showProfileDetails('${u.id}')">Ver detalhes</button>
        <button class="btn-secondary" onclick="adminToggleVerified('${u.id}', ${!u.is_verified})">${u.is_verified ? 'Remover verificação' : 'Verificar'}</button>
        <button class="btn-secondary" onclick="adminToggleBlocked('${u.id}', ${!u.is_blocked})">${u.is_blocked ? 'Desbloquear' : 'Bloquear'}</button>
        ${isAdmin ? (isSup
          ? `<button class="btn-secondary" onclick="adminSetRole('${u.id}', 'adopter')">Remover Supervisão</button>`
          : `<button class="btn-secondary" onclick="adminSetRole('${u.id}', 'supervisor')">Tornar Supervisor</button>`) : ''}
        ${isAdmin ? `<button class="btn-secondary" onclick="adminDeleteUser('${u.id}', decodeURIComponent('${safeName}'))">Excluir</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

async function adminSetRole(userId, newRole) {
  if (!currentUser || currentUser.user_type !== 'admin') return;
  const msg = newRole === 'supervisor'
    ? 'Tornar esta conta Supervisor? Ela poderá verificar e bloquear usuários.'
    : 'Remover a supervisão desta conta? Ela volta a ser Usuário (Adotador).';
  if (!confirm(msg)) return;
  const { error } = await sb.from('profiles').update({ user_type: newRole }).eq('id', userId);
  if (error) { alert('Erro ao alterar o papel: ' + error.message); return; }
  renderAdminUsersList();
}

// ----------------------------------------------------------------------------
// Detalhes da conta (usado por Administrador, Supervisor e ONGs)
// ----------------------------------------------------------------------------
async function showProfileDetails(userId) {
  const modal = document.getElementById('profileDetailModal');
  const box = document.getElementById('profileDetailContent');
  box.innerHTML = '<p style="text-align:center; color:#999;">Carregando...</p>';
  modal.classList.add('active');

  const { data: u, error } = await sb.from('profiles').select('*').eq('id', userId).single();
  if (error || !u) {
    box.innerHTML = '<p style="text-align:center; color:#999;">Não foi possível carregar os dados desta conta.</p>';
    return;
  }

  // Resumo de atividade (só contagens; falha silenciosa se a política do banco não permitir)
  let activity = '';
  if (u.user_type === 'ong') {
    const { count } = await sb.from('pets').select('id', { count: 'exact', head: true }).eq('ong_id', u.id);
    activity = `<p><strong>Pets cadastrados:</strong> ${count ?? '—'}</p>`;
  } else if (u.user_type === 'adopter') {
    const { count } = await sb.from('adoption_requests').select('id', { count: 'exact', head: true }).eq('adopter_id', u.id);
    activity = `<p><strong>Solicitações de adoção:</strong> ${count ?? '—'}</p>`;
  }

  const fmtDate = d => d ? new Date(d).toLocaleDateString('pt-BR') : '—';
  const photos = (u.residence_photos || []).map(url =>
    `<img src="${escapeHtml(url)}" style="width:100px; height:100px; object-fit:cover; border-radius:8px;">`).join('');
  const videos = (u.residence_videos || []).length;

  box.innerHTML = `
    <div style="text-align:center; margin-bottom:1rem;">
      ${u.profile_photo_url
        ? `<img src="${escapeHtml(u.profile_photo_url)}" style="width:110px; height:110px; object-fit:cover; border-radius:50%;">`
        : '<div style="font-size:3.5rem;">👤</div>'}
      <h3 style="margin:0.5rem 0 0.25rem;">${escapeHtml(u.name)}</h3>
      <span style="background: var(--primary-blue); color:#fff; font-size:0.75rem; padding:2px 10px; border-radius:999px;">${escapeHtml(getRoleLabel(u.user_type))}</span>
    </div>
    <p><strong>E-mail:</strong> ${escapeHtml(u.email)}</p>
    <p><strong>Telefone:</strong> ${escapeHtml(u.phone || 'Não informado')}</p>
    <p><strong>Endereço:</strong> ${escapeHtml(u.address || 'Não informado')}</p>
    <p><strong>Cidade:</strong> ${escapeHtml(u.city || 'Não informada')}</p>
    <p><strong>Conta criada em:</strong> ${fmtDate(u.created_at)}</p>
    <p><strong>Verificação da conta:</strong> ${u.is_verified ? '✔ Verificada' : 'Ainda não verificada'}</p>
    <p><strong>Verificação em duas etapas:</strong> ${u.two_factor_verified ? '✔ Concluída' : 'Não concluída'}</p>
    <p><strong>Situação:</strong> ${u.is_blocked ? '🚫 Bloqueada' : 'Ativa'}</p>
    ${activity}
    ${u.user_type === 'adopter' ? `
      <p><strong>Fotos da residência:</strong> ${photos ? '' : 'Nenhuma enviada'}</p>
      ${photos ? `<div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-bottom:0.75rem;">${photos}</div>` : ''}
      <p><strong>Vídeos da residência:</strong> ${videos ? videos + ' enviado(s)' : 'Nenhum enviado'}</p>` : ''}
    <button class="btn-secondary" style="width:100%; margin-top:1rem;" onclick="closeProfileDetailModal()">Fechar</button>
  `;
}

function closeProfileDetailModal() {
  document.getElementById('profileDetailModal').classList.remove('active');
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
// O código fica guardado no localStorage (não só na memória da página), para
// não se perder caso a página recarregue entre o "enviar" e o "confirmar".
function getTwoFactorStorageKey() {
  return `petmatch_2fa_code_${currentUser.id}`;
}

function loadTwoFactorStatus() {
  const statusBox = document.getElementById('twoFactorStatus');
  const verified = currentUser.two_factor_verified;

  statusBox.innerHTML = verified
    ? `<p style="color: var(--primary-green); font-weight:bold; margin:0;">✔ Conta verificada em duas etapas</p>`
    : `<p style="color:#d97706; font-weight:bold; margin:0;">⚠ Conta ainda não verificada</p>`;

  document.getElementById('twoFactorPhone').value = currentUser.phone || '';
  document.getElementById('verificationCodeInput').value = '';

  // Se já existe um código pendente salvo (ex.: a página foi recarregada
  // depois de "Enviar"), mantém a caixa de confirmação visível.
  const pending = localStorage.getItem(getTwoFactorStorageKey());
  document.getElementById('verificationCodeBox').style.display = pending ? 'block' : 'none';
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

  const code = String(Math.floor(100000 + Math.random() * 900000));
  localStorage.setItem(getTwoFactorStorageKey(), code);

  // DEMONSTRAÇÃO ACADÊMICA: sem um serviço de SMS pago (ex.: Twilio) configurado,
  // não há envio real. O código é exibido aqui para simular o recebimento.
  alert(
    `📧 Código enviado para o e-mail: ${currentUser.email}\n` +
    `📱 Código enviado por SMS para: ${phone}\n\n` +
    `(Simulação para fins acadêmicos — código: ${code})`
  );

  document.getElementById('verificationCodeBox').style.display = 'block';
}

async function confirmVerificationCode() {
  const typed = document.getElementById('verificationCodeInput').value.trim();
  const pending = localStorage.getItem(getTwoFactorStorageKey());

  if (!pending) {
    alert('Nenhum código pendente. Clique em "Enviar Código de Verificação" primeiro.');
    return;
  }

  if (typed !== pending) {
    alert('Código incorreto. Tente novamente.');
    return;
  }

  const { error } = await sb.from('profiles').update({ two_factor_verified: true }).eq('id', currentUser.id);
  if (error) {
    alert('Erro ao confirmar verificação: ' + error.message);
    return;
  }

  currentUser.two_factor_verified = true;
  localStorage.removeItem(getTwoFactorStorageKey());
  loadTwoFactorStatus();
  alert('Conta verificada com sucesso! ✔');
}

// ============================================================================
// UTILITÁRIOS COMPARTILHADOS
// ============================================================================
const STATUS_LABELS = {
  pending: 'Pendente',
  approved: 'Aprovada',
  rejected: 'Rejeitada',
  visit_scheduled: 'Visita agendada',
  completed: 'Adoção concluída'
};

// Texto seguro para usar dentro de onclick="...": evita quebrar com aspas no nome
function jsStr(text) {
  return "decodeURIComponent('" + encodeURIComponent(text == null ? '' : String(text)).replace(/'/g, '%27') + "')";
}

function fmtDateTime(value) {
  return value ? new Date(value).toLocaleString('pt-BR') : '—';
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Registra um evento no log do sistema (o banco só aceita ações da lista permitida)
async function logClientEvent(action) {
  try {
    await sb.rpc('log_client_event', { p_action: action });
  } catch (e) {
    // o log nunca deve atrapalhar o uso do site
  }
}

// ============================================================================
// CONTROLE DE HISTÓRICO (linha do tempo de cada solicitação de adoção)
// ============================================================================
async function showRequestHistory(requestId, petName) {
  const modal = document.getElementById('historyModal');
  const box = document.getElementById('historyContent');
  box.innerHTML = '<p style="text-align:center; color:#999;">Carregando...</p>';
  modal.classList.add('active');

  const { data: rows, error } = await sb
    .from('request_history')
    .select('status, created_at')
    .eq('request_id', requestId)
    .order('created_at', { ascending: true });

  if (error) {
    box.innerHTML = `<p style="text-align:center; color:#999;">Não foi possível carregar o histórico: ${escapeHtml(error.message)}</p>`;
    return;
  }

  const items = (rows || []).map((row, i, all) => `
    <div style="display:flex; gap:0.75rem; align-items:flex-start;">
      <div style="display:flex; flex-direction:column; align-items:center;">
        <div style="width:16px; height:16px; border-radius:50%; background:${row.status === 'rejected' ? '#d33' : 'var(--primary-green)'}; margin-top:4px;"></div>
        ${i < all.length - 1 ? '<div style="width:3px; flex:1; min-height:28px; background:#ccc;"></div>' : ''}
      </div>
      <div style="padding-bottom:1rem;">
        <strong>${escapeHtml(STATUS_LABELS[row.status] || row.status)}</strong>
        <div style="font-size:0.85rem; color:#777;">${escapeHtml(fmtDateTime(row.created_at))}</div>
      </div>
    </div>`).join('');

  box.innerHTML = `
    <h3 style="margin-bottom:0.25rem;">Histórico da solicitação</h3>
    <p style="color:#777; margin-bottom:1.25rem;">Pet: <strong>${escapeHtml(petName)}</strong></p>
    ${items || '<p style="color:#999;">Nenhum registro de histórico para esta solicitação.</p>'}
    <button class="btn-secondary" style="width:100%; margin-top:0.5rem;" onclick="closeHistoryModal()">Fechar</button>
  `;
}

function closeHistoryModal() {
  document.getElementById('historyModal').classList.remove('active');
}

// ============================================================================
// AJUDA E RECLAMAÇÕES
// ============================================================================
const COMPLAINT_KINDS = { help: 'Ajuda', complaint: 'Reclamação', suggestion: 'Sugestão' };
const COMPLAINT_STATUS = { open: 'Aberta', in_progress: 'Em andamento', resolved: 'Resolvida' };

async function loadHelpPage() {
  const notice = document.getElementById('helpLoginNotice');
  const form = document.getElementById('helpForm');
  const title = document.getElementById('myComplaintsTitle');
  const list = document.getElementById('myComplaintsList');

  if (!currentUser) {
    notice.style.display = 'block';
    form.style.display = 'none';
    title.style.display = 'none';
    list.innerHTML = '';
    return;
  }

  notice.style.display = 'none';
  form.style.display = 'block';
  title.style.display = 'block';
  list.innerHTML = '<p style="color:#999;">Carregando...</p>';

  const { data: rows, error } = await sb
    .from('complaints')
    .select('*')
    .eq('author_id', currentUser.id)
    .order('created_at', { ascending: false });

  if (error) {
    list.innerHTML = `<p style="color:#999;">Não foi possível carregar suas mensagens: ${escapeHtml(error.message)}</p>`;
    return;
  }

  if (!rows || rows.length === 0) {
    list.innerHTML = '<p style="color:#999;">Você ainda não enviou nenhuma mensagem.</p>';
    return;
  }

  list.innerHTML = rows.map(c => `
    <div style="background: var(--light-bg); padding: 1rem 1.2rem; border-radius: 12px; margin-bottom: 1rem; border-left: 4px solid ${c.status === 'resolved' ? 'var(--primary-green)' : 'var(--primary-blue)'};">
      <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:0.5rem;">
        <strong>${escapeHtml(c.subject)}</strong>
        <span style="font-size:0.8rem; color:#777;">${escapeHtml(COMPLAINT_KINDS[c.kind] || c.kind)} · ${escapeHtml(COMPLAINT_STATUS[c.status] || c.status)} · ${escapeHtml(fmtDateTime(c.created_at))}</span>
      </div>
      <p style="margin:0.5rem 0; white-space:pre-wrap;">${escapeHtml(c.message)}</p>
      ${c.response ? `<div style="background:#fff; padding:0.75rem; border-radius:8px;"><strong>Resposta da equipe:</strong><p style="white-space:pre-wrap; margin-top:0.25rem;">${escapeHtml(c.response)}</p></div>` : ''}
    </div>`).join('');
}

async function submitComplaint() {
  if (!currentUser) {
    alert('Faça login para enviar uma mensagem.');
    openAuthModal();
    return;
  }

  const kind = document.getElementById('complaintKind').value;
  const subject = document.getElementById('complaintSubject').value.trim();
  const message = document.getElementById('complaintMessage').value.trim();

  if (!subject || !message) {
    alert('Preencha o assunto e a mensagem.');
    return;
  }

  const { error } = await sb.from('complaints').insert([{
    author_id: currentUser.id,
    author_name: currentUser.name,
    author_email: currentUser.email,
    kind,
    subject: subject.slice(0, 150),
    message: message.slice(0, 3000)
  }]);

  if (error) {
    alert('Não foi possível enviar a mensagem: ' + error.message);
    return;
  }

  document.getElementById('complaintSubject').value = '';
  document.getElementById('complaintMessage').value = '';
  alert('Mensagem enviada! A equipe responde por aqui mesmo.');
  loadHelpPage();
}

// ============================================================================
// PAINEL ADM / SUPERVISOR: abas (usuários, reclamações, logs)
// ============================================================================
function switchStaffTab(tab) {
  const isAdmin = currentUser && currentUser.user_type === 'admin';
  if (tab === 'logs' && !isAdmin) tab = 'users';

  document.querySelectorAll('#page-admin-panel .admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#page-admin-panel .admin-tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`staff-${tab}`).classList.add('active');
  document.getElementById(`staffTabBtn-${tab}`).classList.add('active');

  if (tab === 'commerce') renderCommerceLists();
  else if (tab === 'users') renderAdminUsersList();
  else if (tab === 'complaints') renderStaffComplaints();
  else if (tab === 'approvals') renderApprovals();
  else if (tab === 'overview') renderOverview();
  else if (tab === 'logs') renderSystemLogs();
}

async function renderStaffComplaints() {
  const container = document.getElementById('staffComplaintsList');
  const filter = document.getElementById('staffComplaintFilter').value;
  container.innerHTML = '<p style="text-align:center; color:#999;">Carregando...</p>';

  let query = sb.from('complaints').select('*').order('created_at', { ascending: false }).limit(100);
  if (filter) query = query.eq('status', filter);
  const { data: rows, error } = await query;

  if (error) {
    container.innerHTML = `<p style="text-align:center; color:#999;">Erro ao carregar mensagens: ${escapeHtml(error.message)}</p>`;
    return;
  }

  if (!rows || rows.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:#999;">Nenhuma mensagem encontrada.</p>';
    return;
  }

  const statusColor = { open: '#d9822b', in_progress: 'var(--primary-blue)', resolved: 'var(--primary-green)' };

  container.innerHTML = rows.map(c => `
    <div style="background: var(--light-bg); padding: 1rem 1.2rem; border-radius: 12px; margin-bottom: 1rem;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
        <strong>${escapeHtml(c.subject)}</strong>
        <span style="background:${statusColor[c.status] || '#999'}; color:#fff; font-size:0.7rem; padding:2px 10px; border-radius:999px;">${escapeHtml(COMPLAINT_STATUS[c.status] || c.status)}</span>
      </div>
      <p style="font-size:0.85rem; color:#666; margin:0.25rem 0;">${escapeHtml(COMPLAINT_KINDS[c.kind] || c.kind)} · ${escapeHtml(c.author_name || 'Conta excluída')}${c.author_email ? ' · ' + escapeHtml(c.author_email) : ''} · ${escapeHtml(fmtDateTime(c.created_at))}</p>
      <p style="margin:0.5rem 0; white-space:pre-wrap;">${escapeHtml(c.message)}</p>
      ${c.response ? `<div style="background:#fff; padding:0.75rem; border-radius:8px; margin-bottom:0.5rem;"><strong>Resposta enviada:</strong><p style="white-space:pre-wrap; margin-top:0.25rem;">${escapeHtml(c.response)}</p></div>` : ''}
      <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
        <button class="btn-primary" onclick="respondComplaint('${c.id}')">${c.response ? 'Editar resposta' : 'Responder'}</button>
        ${c.status === 'open' ? `<button class="btn-secondary" onclick="setComplaintStatus('${c.id}', 'in_progress')">Marcar em andamento</button>` : ''}
        ${c.status === 'resolved' ? `<button class="btn-secondary" onclick="setComplaintStatus('${c.id}', 'open')">Reabrir</button>` : ''}
      </div>
    </div>`).join('');
}

async function respondComplaint(id) {
  const text = prompt('Digite a resposta para o usuário:');
  if (!text || !text.trim()) return;

  const { error } = await sb.from('complaints').update({
    response: text.trim().slice(0, 3000),
    status: 'resolved',
    responded_by: currentUser.id,
    responded_at: new Date().toISOString()
  }).eq('id', id);

  if (error) { alert('Não foi possível enviar a resposta: ' + error.message); return; }
  renderStaffComplaints();
}

async function setComplaintStatus(id, status) {
  const { error } = await sb.from('complaints').update({ status }).eq('id', id);
  if (error) { alert('Não foi possível atualizar: ' + error.message); return; }
  renderStaffComplaints();
}

// ============================================================================
// LOG DE SISTEMA (somente Administrador)
// ============================================================================
const LOG_LABELS = {
  login: 'Login',
  logout: 'Logout',
  cadastro: 'Cadastro de conta',
  solicitacao_pending: 'Solicitação de adoção criada',
  solicitacao_approved: 'Solicitação aprovada',
  solicitacao_rejected: 'Solicitação rejeitada',
  solicitacao_visit_scheduled: 'Visita agendada',
  solicitacao_completed: 'Adoção concluída',
  conta_verificada: 'Conta verificada',
  verificacao_removida: 'Verificação removida',
  conta_bloqueada: 'Conta bloqueada',
  conta_desbloqueada: 'Conta desbloqueada',
  papel_alterado: 'Papel alterado',
  conta_excluida: 'Conta excluída',
  pet_cadastrado: 'Pet cadastrado',
  pet_excluido: 'Pet excluído',
  parceiro_cadastrado: 'Parceiro cadastrado',
  parceiro_excluido: 'Parceiro excluído',
  anuncio_cadastrado: 'Anúncio publicado',
  anuncio_excluido: 'Anúncio excluído',
  produto_cadastrado: 'Produto cadastrado',
  produto_excluido: 'Produto excluído',
  mensagem_enviada: 'Mensagem enviada (ajuda)',
  mensagem_respondida: 'Mensagem respondida',
  '2fa_concluida': 'Verificação em duas etapas concluída',
  exportou_dados: 'Baixou os próprios dados (LGPD)',
  aceitou_lgpd: 'Aceitou a Política de Privacidade',
  plano_assinado: 'Plano assinado',
  plano_cancelado: 'Plano cancelado',
  plano_alterado_admin: 'Plano alterado pelo Administrador',
  membro_adicionado: 'Administrador adicionado à ONG',
  conteudo_aprovado: 'Conteúdo aprovado',
  conteudo_rejeitado: 'Conteúdo rejeitado'
};

const LOG_GROUPS = {
  access: ['login', 'logout', 'cadastro'],
  requests: ['solicitacao_pending', 'solicitacao_approved', 'solicitacao_rejected', 'solicitacao_visit_scheduled', 'solicitacao_completed'],
  moderation: ['conta_verificada', 'verificacao_removida', 'conta_bloqueada', 'conta_desbloqueada', 'papel_alterado', 'conta_excluida'],
  pets: ['pet_cadastrado', 'pet_excluido'],
  commerce: ['parceiro_cadastrado', 'parceiro_excluido', 'anuncio_cadastrado', 'anuncio_excluido', 'produto_cadastrado', 'produto_excluido'],
  messages: ['mensagem_enviada', 'mensagem_respondida'],
  lgpd: ['aceitou_lgpd', 'exportou_dados', '2fa_concluida']
};

let lastLogRows = [];

async function renderSystemLogs() {
  const container = document.getElementById('staffLogsList');
  if (!currentUser || currentUser.user_type !== 'admin') {
    container.innerHTML = '<p style="color:#999;">Apenas o Administrador acessa os logs.</p>';
    return;
  }
  container.innerHTML = '<p style="text-align:center; color:#999;">Carregando...</p>';

  const group = document.getElementById('staffLogFilter').value;
  let query = sb.from('system_logs').select('*').order('created_at', { ascending: false }).limit(300);
  if (group && LOG_GROUPS[group]) query = query.in('action', LOG_GROUPS[group]);
  const { data: logs, error } = await query;

  if (error) {
    container.innerHTML = `<p style="color:#999;">Erro ao carregar os logs: ${escapeHtml(error.message)}. Confira se o SQL de histórico, logs, ajuda e LGPD foi executado no Supabase.</p>`;
    return;
  }

  if (!logs || logs.length === 0) {
    lastLogRows = [];
    container.innerHTML = '<p style="text-align:center; color:#999;">Nenhum registro encontrado.</p>';
    return;
  }

  // Resolve o nome da conta envolvida (quando ela ainda existe)
  const targetIds = [...new Set(logs.map(l => l.target_id).filter(Boolean))];
  let nameById = {};
  if (targetIds.length > 0) {
    const { data: profiles } = await sb.from('profiles').select('id, name').in('id', targetIds);
    nameById = Object.fromEntries((profiles || []).map(p => [p.id, p.name]));
  }

  lastLogRows = logs.map(l => [
    fmtDateTime(l.created_at),
    l.actor_name || 'Sistema',
    l.actor_role === 'sistema' ? 'Sistema' : getRoleLabel(l.actor_role),
    LOG_LABELS[l.action] || l.action,
    l.target_id ? (nameById[l.target_id] || 'Conta excluída') : '',
    l.details || ''
  ]);

  container.innerHTML = `
    <table class="log-table">
      <thead><tr><th>Data e hora</th><th>Quem fez</th><th>Perfil</th><th>Ação</th><th>Conta envolvida</th><th>Detalhes</th></tr></thead>
      <tbody>${lastLogRows.map(r => `<tr>${r.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
    <p style="color:#999; font-size:0.8rem; margin-top:0.5rem;">Mostrando os ${lastLogRows.length} registros mais recentes.</p>`;
}

function exportLogsCsv() {
  if (!lastLogRows.length) {
    alert('Não há registros carregados para baixar.');
    return;
  }
  const header = ['Data e hora', 'Quem fez', 'Perfil', 'Ação', 'Conta envolvida', 'Detalhes'];
  const esc = v => '"' + String(v).replace(/"/g, '""') + '"';
  const csv = [header, ...lastLogRows].map(r => r.map(esc).join(';')).join('\n');
  downloadFile('logs-petmatch.csv', '﻿' + csv, 'text/csv;charset=utf-8');
}

// ============================================================================
// LGPD (consentimento, política, baixar dados e excluir conta)
// ============================================================================
const LGPD_NOTICE_KEY = 'petmatch_privacy_notice_v1';

function openPrivacy() {
  closeAuthModal();
  showPage('privacy');
}

function renderLgpdBanner() {
  const banner = document.getElementById('lgpdBanner');
  if (!banner) return;
  const text = document.getElementById('lgpdBannerText');
  const btn = document.getElementById('lgpdBannerBtn');

  if (currentUser && !currentUser.lgpd_consent_at) {
    text.textContent = 'Para continuar usando o PetMatch, leia a Política de Privacidade (LGPD) e confirme o seu consentimento.';
    btn.textContent = 'Aceitar';
    banner.style.display = 'flex';
    return;
  }

  let seen = false;
  try { seen = localStorage.getItem(LGPD_NOTICE_KEY) === '1'; } catch (e) { /* sem storage */ }
  if (!currentUser && !seen) {
    text.textContent = 'O PetMatch guarda no seu navegador apenas o necessário para o funcionamento do site (login e verificação em duas etapas). Não usamos cookies de rastreamento.';
    btn.textContent = 'Entendi';
    banner.style.display = 'flex';
    return;
  }

  banner.style.display = 'none';
}

async function handleLgpdBanner() {
  if (currentUser && !currentUser.lgpd_consent_at) {
    await acceptLgpd();
    return;
  }
  try { localStorage.setItem(LGPD_NOTICE_KEY, '1'); } catch (e) { /* sem storage */ }
  document.getElementById('lgpdBanner').style.display = 'none';
}

async function acceptLgpd() {
  if (!currentUser) return;
  const now = new Date().toISOString();
  const { error } = await sb.from('profiles')
    .update({ lgpd_consent_at: now, lgpd_consent_version: '1.0' })
    .eq('id', currentUser.id);
  if (error) { alert('Não foi possível registrar o consentimento: ' + error.message); return; }
  currentUser.lgpd_consent_at = now;
  logClientEvent('aceitou_lgpd');
  renderLgpdBanner();
  if (currentPage === 'lgpd') loadLgpdPage();
}

function loadLgpdPage() {
  const box = document.getElementById('lgpdStatus');
  if (!currentUser) return;
  if (currentUser.lgpd_consent_at) {
    box.innerHTML = `<p><strong>Consentimento:</strong> ✔ registrado em ${escapeHtml(fmtDateTime(currentUser.lgpd_consent_at))} (política versão ${escapeHtml(currentUser.lgpd_consent_version || '1.0')}).</p>`;
  } else {
    box.innerHTML = `
      <p><strong>Consentimento:</strong> ainda não registrado.</p>
      <button class="btn-primary" style="margin-top:0.75rem;" onclick="acceptLgpd()">Aceitar a Política de Privacidade</button>`;
  }
}

async function exportMyData() {
  if (!currentUser) return;
  const uid = currentUser.id;

  const fetchRows = async (table, column) => {
    const { data } = await sb.from(table).select('*').eq(column, uid);
    return data || [];
  };

  const profileResult = await sb.from('profiles').select('*').eq('id', uid).single();
  const [favorites, requests, notifications, complaints, pets] = await Promise.all([
    fetchRows('favorites', 'adopter_id'),
    fetchRows('adoption_requests', 'adopter_id'),
    fetchRows('notifications', 'adopter_id'),
    fetchRows('complaints', 'author_id'),
    currentUser.user_type === 'ong' ? fetchRows('pets', 'ong_id') : Promise.resolve([])
  ]);

  const payload = {
    gerado_em: new Date().toISOString(),
    observacao: 'Cópia dos dados pessoais guardados pelo PetMatch (LGPD, art. 18).',
    perfil: profileResult.data || null,
    favoritos: favorites,
    solicitacoes_de_adocao: requests,
    notificacoes: notifications,
    mensagens_de_ajuda: complaints,
    pets_cadastrados: pets
  };

  downloadFile('meus-dados-petmatch.json', JSON.stringify(payload, null, 2), 'application/json');
  logClientEvent('exportou_dados');
}

async function deleteMyAccount() {
  if (!currentUser) return;

  if (['admin', 'supervisor'].includes(currentUser.user_type)) {
    alert('Contas de Administrador e Supervisor só podem ser removidas pelo Administrador do sistema.');
    return;
  }

  const ongWarning = currentUser.user_type === 'ong'
    ? '\n\nAtenção: os pets e as solicitações da sua ONG também serão apagados.'
    : '';
  if (!confirm('Excluir a sua conta? Seu login, seu perfil e os dados ligados a ele serão apagados e isso não pode ser desfeito.' + ongWarning)) return;

  const typed = prompt('Para confirmar, digite EXCLUIR:');
  if (!typed || typed.trim().toUpperCase() !== 'EXCLUIR') {
    alert('Exclusão cancelada.');
    return;
  }

  const { error } = await sb.rpc('delete_my_account');
  if (error) {
    alert('Não foi possível excluir a conta: ' + error.message);
    return;
  }

  try { await sb.auth.signOut(); } catch (e) { /* o login já foi removido */ }
  currentUser = null;
  updateHeader();
  showPage('home');
  document.getElementById('profileMenu').style.display = 'none';
  alert('Sua conta e os seus dados foram excluídos.');
}


async function afterAuth() {
  // reservado para ações depois do login
}

// Marca o plano atual na página Planos

// ===== PARCEIROS, ANÚNCIOS E LOJINHA =====
const PARTNER_CATEGORIES = {
  petshop: '🐾 Pet shop', clinica: '🩺 Clínica veterinária', racao: '🥣 Ração',
  banho_tosa: '🛁 Banho e tosa', hotel: '🏨 Hotelzinho', outro: '⭐ Outro'
};
const PRODUCT_CATEGORIES = {
  caminha: '🛏️ Caminha', roupa: '👕 Roupa', coleira: '🦮 Coleira', brinquedo: '🎾 Brinquedo', outro: '🎁 Outro'
};

let adsCache = null;
let partnersCache = [];
let productsCache = [];
let shopCategory = '';

function safeLink(url) {
  return /^https?:\/\//i.test(url || '') ? url : '';
}

// Imagem: link https ou arquivo da pasta images do site (ex.: images/caminha.png)
function safeImage(url) {
  const u = (url || '').trim();
  if (/^https?:\/\//i.test(u)) return u;
  return /^images\/[\w\-. ]+\.(png|jpe?g|webp|gif|svg)$/i.test(u) ? u : '';
}

// CEP: só números (8 dígitos) e formato 00000-000
function normCep(v) {
  return String(v || '').replace(/\D/g, '').slice(0, 8);
}
function formatCep(v) {
  const d = normCep(v);
  return d.length > 5 ? d.slice(0, 5) + '-' + d.slice(5) : d;
}
// Quantos dígitos iniciais dois CEPs têm em comum (mais dígitos = mais perto)
function cepCommon(a, b) {
  const x = normCep(a), y = normCep(b);
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i;
}

function formatPrice(value) {
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Anúncios: da cidade do usuário (se tiver) ou de todas as cidades
async function loadAds() {
  if (adsCache === null) {
    const { data, error } = await sb.from('ads').select('*').eq('active', true).order('created_at', { ascending: false });
    adsCache = error ? [] : (data || []);
  }
  renderAds();
}

function renderAds() {
  const city = (currentUser?.city || '').trim().toLowerCase();
  const ads = (adsCache || []).filter(ad => !ad.city || !city || ad.city.toLowerCase() === city).slice(0, 3);
  const html = ads.map(ad => {
    const link = safeLink(ad.link_url);
    return `<div class="ad-card ad-${ad.kind === 'prefeitura' ? 'gov' : 'biz'}">
      <span class="ad-tag">${ad.kind === 'prefeitura' ? '🏛️ Prefeitura' : '📢 Anúncio'}</span>
      <b>${escapeHtml(ad.title)}</b>
      ${ad.body ? `<p>${escapeHtml(ad.body)}</p>` : ''}
      <small>${escapeHtml(ad.advertiser || '')}${ad.city ? ' • ' + escapeHtml(ad.city) : ''}</small>
      <a href="#" onclick="openAdModal('${ad.id}'); return false;">Saiba mais</a>
    </div>`;
  }).join('');
  document.querySelectorAll('.ads-strip').forEach(el => {
    el.innerHTML = html;
    el.style.display = html ? '' : 'none';
  });
}

async function loadPartnersPage() {
  const cityInput = document.getElementById('partnerCity');
  if (cityInput && !cityInput.dataset.touched) {
    cityInput.value = currentUser?.city || '';
    cityInput.dataset.touched = '1';
    const cepInput = document.getElementById('partnerCep');
    if (cepInput) cepInput.value = formatCep(currentUser?.cep);
  }
  const { data, error } = await sb.from('partners').select('*').eq('active', true);
  partnersCache = error ? [] : (data || []);
  renderPartners();
}

function renderPartners() {
  const grid = document.getElementById('partnersGrid');
  const city = document.getElementById('partnerCity').value.trim().toLowerCase();
  const cepTyped = normCep(document.getElementById('partnerCep').value);
  const cat = document.getElementById('partnerCategory').value;

  const list = partnersCache
    .filter(p => !city || p.city.toLowerCase().includes(city))
    .filter(p => !cepTyped || cepTyped.length < 5 || cepCommon(p.cep, cepTyped) >= 5)
    .filter(p => !cat || p.category === cat)
    .sort((a, b) => Number(b.is_featured) - Number(a.is_featured)
      || distanceKm(a) - distanceKm(b)
      || cepCommon(b.cep, cepTyped) - cepCommon(a.cep, cepTyped)
      || a.name.localeCompare(b.name));

  if (!list.length) {
    grid.innerHTML = '<p style="text-align:center; color:#999; grid-column:1/-1;">Nenhum parceiro encontrado nessa região.</p>';
    return;
  }
  grid.innerHTML = list.map(p => {
    const site = safeLink(p.website);
    return `<div class="partner-card ${p.is_featured ? 'is-featured' : ''}">
      ${p.is_featured ? '<span class="partner-badge">⭐ Destaque</span>' : ''}
      <span class="partner-cat">${PARTNER_CATEGORIES[p.category] || PARTNER_CATEGORIES.outro}</span>
      <h3>${escapeHtml(p.name)}</h3>
      <p>📍 ${escapeHtml(p.city)}${p.cep ? ' • CEP ' + escapeHtml(formatCep(p.cep)) : ''}</p>
      ${Number.isFinite(distanceKm(p)) ? `<p class="partner-distance">📏 a ${formatKm(distanceKm(p))} de você</p>` : ''}
      ${p.address ? `<p>🏠 ${escapeHtml(p.address)}</p>` : ''}
      ${p.phone ? `<p>📞 ${escapeHtml(p.phone)}</p>` : ''}
      ${p.description ? `<p class="partner-desc">${escapeHtml(p.description)}</p>` : ''}
      ${site ? `<a href="${escapeHtml(site)}" target="_blank" rel="noopener noreferrer">Visitar site</a>` : ''}
    </div>`;
  }).join('');
}

async function loadShopPage() {
  const [prod, part] = await Promise.all([
    sb.from('products').select('*').eq('active', true).order('created_at', { ascending: false }),
    sb.from('partners').select('id, name').eq('active', true)
  ]);
  productsCache = prod.error ? [] : (prod.data || []);
  partnersCache = partnersCache.length ? partnersCache : (part.data || []);
  window.__partnerNames = Object.fromEntries((part.data || []).map(p => [p.id, p.name]));
  renderShop();
}

let shopSpecies = '';
const SPECIES_WORDS = ['cães', 'gatos', 'coelhos', 'pássaros'];

function setShopCategory(cat) {
  shopCategory = cat;
  document.querySelectorAll('#shopCats button').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
  renderShop();
}
function setShopSpecies(sp) {
  shopSpecies = sp;
  document.querySelectorAll('#shopSpecies button').forEach(b => b.classList.toggle('active', b.dataset.sp === sp));
  renderShop();
}

// Favoritos ficam guardados só neste aparelho
let shopFavs = [];
try { shopFavs = JSON.parse(localStorage.getItem('petmatch_shop_favs') || '[]'); if (!Array.isArray(shopFavs)) shopFavs = []; } catch (e) { shopFavs = []; }
function toggleShopFav(id, ev) {
  if (ev) ev.stopPropagation();
  shopFavs = shopFavs.includes(id) ? shopFavs.filter(x => x !== id) : shopFavs.concat(id);
  try { localStorage.setItem('petmatch_shop_favs', JSON.stringify(shopFavs)); } catch (e) { /* sem armazenamento */ }
  renderShop();
}

// O produto serve ao animal escolhido se citar essa espécie ou se não citar nenhuma (serve para todos)
function productFitsSpecies(p, sp) {
  if (!sp) return true;
  const txt = (p.name + ' ' + (p.description || '')).toLowerCase();
  const cited = SPECIES_WORDS.filter(w => txt.includes(w));
  return !cited.length || cited.includes(sp);
}

function productCardHtml(p) {
  const img = safeImage(p.image_url);
  const fav = shopFavs.includes(p.id);
  return `<div class="partner-card product-card">
    <button type="button" class="fav-btn ${fav ? 'on' : ''}" onclick="toggleShopFav('${p.id}', event)" aria-label="Favoritar">${fav ? '♥' : '♡'}</button>
    <div class="product-click" onclick="openProduct('${p.id}')">
      ${img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(p.name)}" class="product-img" loading="lazy">` : `<div class="product-img product-noimg">${(PRODUCT_CATEGORIES[p.category] || '🎁').split(' ')[0]}</div>`}
      <h3>${escapeHtml(p.name)}</h3>
      <div class="product-price">${formatPrice(p.price)}</div>
      <small class="partner-desc">${p.price >= 150 ? 'Frete grátis' : 'Frete grátis acima de R$ 150'}</small>
    </div>
    <button type="button" class="btn-primary" onclick="openProduct('${p.id}')">Ver produto</button>
  </div>`;
}

function renderShop() {
  const grid = document.getElementById('shopGrid');
  const q = (document.getElementById('shopSearch')?.value || '').trim().toLowerCase();
  const sort = document.getElementById('shopSort')?.value || 'new';
  let list = productsCache.filter(p => {
    if (shopCategory === 'fav') { if (!shopFavs.includes(p.id)) return false; }
    else if (shopCategory && p.category !== shopCategory) return false;
    if (!productFitsSpecies(p, shopSpecies)) return false;
    return !q || (p.name + ' ' + (p.description || '')).toLowerCase().includes(q);
  });
  if (sort === 'low') list = list.slice().sort((a, b) => a.price - b.price);
  else if (sort === 'high') list = list.slice().sort((a, b) => b.price - a.price);
  else if (sort === 'az') list = list.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  updateCartBadge();
  const count = document.getElementById('shopCount');
  const filtered = shopCategory || shopSpecies || q;
  if (count) count.innerHTML = `${list.length} produto(s)` + (filtered ? ` <a href="#" onclick="clearShopFilters(); return false;">Limpar filtros</a>` : '');
  if (!list.length) {
    grid.innerHTML = '<p style="text-align:center; color:#999; grid-column:1/-1;">Nenhum produto encontrado. Tente outra busca ou limpe os filtros.</p>';
    return;
  }
  grid.innerHTML = list.map(productCardHtml).join('');
}

function clearShopFilters() {
  shopCategory = ''; shopSpecies = '';
  const s = document.getElementById('shopSearch'); if (s) s.value = '';
  document.querySelectorAll('#shopCats button').forEach(b => b.classList.toggle('active', b.dataset.cat === ''));
  document.querySelectorAll('#shopSpecies button').forEach(b => b.classList.toggle('active', b.dataset.sp === ''));
  renderShop();
}

// ----- Carrinho e compra simulada -----
const SIZED_CATEGORIES = ['roupa', 'coleira'];
const SIZE_GUIDE = [['P', 'até 5 kg'], ['M', 'de 5 a 12 kg'], ['G', 'de 12 a 25 kg'], ['GG', 'acima de 25 kg']];
const COUPONS = { PETMATCH10: 10 };
let cart = [];
let couponCode = '';
try { cart = JSON.parse(localStorage.getItem('petmatch_cart') || '[]'); if (!Array.isArray(cart)) cart = []; } catch (e) { cart = []; }

function saveCart() {
  try { localStorage.setItem('petmatch_cart', JSON.stringify(cart)); } catch (e) { /* sem armazenamento */ }
  updateCartBadge();
}
function updateCartBadge() {
  const n = cart.reduce((s, i) => s + i.qty, 0);
  const el = document.getElementById('cartBadge');
  if (el) el.textContent = n;
  const fab = document.getElementById('cartFab');
  if (fab) {
    fab.classList.toggle('has-items', n > 0);
    const tot = document.getElementById('cartFabTotal');
    if (tot) tot.textContent = n ? '· ' + formatPrice(cartTotals().total) : '';
  }
}
function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

function openProduct(id) {
  const p = productsCache.find(x => x.id === id);
  if (!p) return;
  const img = safeImage(p.image_url);
  const sized = SIZED_CATEGORIES.includes(p.category);
  const related = productsCache.filter(x => x.id !== id && x.category === p.category).slice(0, 4);
  openPetToolModal(`
    <div class="pd">
      ${img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(p.name)}" class="pd-img">` : ''}
      <span class="partner-cat">${PRODUCT_CATEGORIES[p.category] || PRODUCT_CATEGORIES.outro}</span>
      <h2>${escapeHtml(p.name)}</h2>
      <div class="product-price" style="font-size:1.5rem;">${formatPrice(p.price)}</div>
      <small class="partner-desc">${p.price >= 150 ? '🚚 Frete grátis' : 'Frete grátis acima de R$ 150'}</small>
      ${p.description ? `<p>${escapeHtml(p.description)}</p>` : ''}
      ${sized ? `<h4>Tamanho</h4><div class="size-picker" id="pdSizes">${SIZE_GUIDE.map(([s]) => `<button type="button" class="size-btn" data-size="${s}" onclick="pickSize('${s}')">${s}</button>`).join('')}</div>
        <details class="size-guide"><summary>Guia de tamanhos</summary>${SIZE_GUIDE.map(([s, w]) => `<div><b>${s}</b> — ${w}</div>`).join('')}<small>Dica: meça o peito do pet e compare com o peso; na dúvida, escolha o tamanho maior.</small></details>` : ''}
      <h4>Quantidade</h4>
      <div class="qty"><button type="button" onclick="pdQty(-1)">−</button><span id="pdQty">1</span><button type="button" onclick="pdQty(1)">+</button></div>
      <div class="pd-actions">
        <button type="button" class="btn-secondary" onclick="addToCart('${p.id}', false)">Adicionar ao carrinho</button>
        <button type="button" class="btn-primary" onclick="addToCart('${p.id}', true)">Comprar agora</button>
      </div>
      ${related.length ? `<h4>Você também pode gostar</h4><div class="related">${related.map(r => `<div class="related-item" onclick="openProduct('${r.id}')">${safeImage(r.image_url) ? `<img src="${escapeHtml(safeImage(r.image_url))}" alt="" loading="lazy">` : '<div class="cart-noimg">🎁</div>'}<small>${escapeHtml(r.name)}</small><b>${formatPrice(r.price)}</b></div>`).join('')}</div>` : ''}
    </div>`);
  window.__pdSize = null;
}
function pickSize(s) {
  window.__pdSize = s;
  document.querySelectorAll('#pdSizes .size-btn').forEach(b => b.classList.toggle('active', b.dataset.size === s));
}
function pdQty(d) {
  const el = document.getElementById('pdQty');
  el.textContent = Math.min(20, Math.max(1, parseInt(el.textContent, 10) + d));
}

function addToCart(id, goCart) {
  const p = productsCache.find(x => x.id === id);
  if (!p) return;
  const sized = SIZED_CATEGORIES.includes(p.category);
  if (sized && !window.__pdSize) { alert('Escolha o tamanho primeiro.'); return; }
  const qty = parseInt(document.getElementById('pdQty').textContent, 10) || 1;
  const size = sized ? window.__pdSize : null;
  const found = cart.find(i => i.id === id && i.size === size);
  if (found) found.qty = Math.min(20, found.qty + qty);
  else cart.push({ id, name: p.name, price: p.price, image: p.image_url || null, size, qty });
  saveCart();
  if (goCart) openCart(); else { closePetToolModal(); showToast('Adicionado ao carrinho'); }
}

function cartTotals() {
  const raw = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const pct = COUPONS[couponCode] || 0;
  const discount = raw * pct / 100;
  const sub = raw - discount;
  const shipping = !cart.length || sub >= 150 ? 0 : 12.9;
  return { raw, discount, pct, sub, shipping, total: sub + shipping };
}

function applyCoupon() {
  const code = (document.getElementById('coCoupon').value || '').trim().toUpperCase();
  if (!code) { couponCode = ''; openCart(); return; }
  if (!COUPONS[code]) { alert('Cupom inválido.'); return; }
  couponCode = code;
  openCart();
}

function openCart() {
  if (!cart.length) {
    openPetToolModal('<h2>🛒 Seu carrinho</h2><p style="color:#888;">O carrinho está vazio. Escolha produtos na vitrine.</p><button type="button" class="btn-primary" onclick="closePetToolModal()">Ver produtos</button>');
    return;
  }
  const t = cartTotals();
  openPetToolModal(`
    <h2>🛒 Seu carrinho</h2>
    ${cart.map((i, idx) => `
      <div class="cart-line">
        ${safeImage(i.image) ? `<img src="${escapeHtml(safeImage(i.image))}" alt="">` : '<div class="cart-noimg">🎁</div>'}
        <div class="cart-info"><b>${escapeHtml(i.name)}</b>${i.size ? `<br><small>Tamanho ${escapeHtml(i.size)}</small>` : ''}<br><small>${formatPrice(i.price)} cada</small></div>
        <div class="qty"><button type="button" onclick="cartQty(${idx}, -1)">−</button><span>${i.qty}</span><button type="button" onclick="cartQty(${idx}, 1)">+</button></div>
        <button type="button" class="btn-secondary" style="color:#c0392b; padding:2px 10px;" onclick="cartRemove(${idx})">✕</button>
      </div>`).join('')}
    <div class="coupon-row"><input type="text" id="coCoupon" placeholder="Cupom de desconto" value="${escapeHtml(couponCode)}" maxlength="20"><button type="button" class="btn-secondary" onclick="applyCoupon()">Aplicar</button></div>
    <div class="cart-totals">
      <div><span>Subtotal</span><span>${formatPrice(t.raw)}</span></div>
      ${t.discount ? `<div class="partner-plus"><span>Cupom ${escapeHtml(couponCode)} (${t.pct}%)</span><span>− ${formatPrice(t.discount)}</span></div>` : ''}
      <div><span>Frete</span><span>${t.shipping ? formatPrice(t.shipping) : 'Grátis'}</span></div>
      ${!t.shipping ? '' : `<small>Faltam ${formatPrice(150 - t.sub)} para o frete grátis.</small>`}
      <div class="cart-total"><span>Total</span><span>${formatPrice(t.total)}</span></div>
    </div>
    <h4>Entrega e pagamento</h4>
    <form onsubmit="checkoutOrder(event)" class="commerce-form">
      <input type="text" id="coName" placeholder="Nome completo" required maxlength="100" value="${escapeHtml(currentUser?.name || '')}">
      <input type="text" id="coCep" placeholder="CEP" required inputmode="numeric" maxlength="9" value="${escapeHtml(formatCep(currentUser?.cep || ''))}">
      <input type="text" id="coAddress" placeholder="Endereço e número" required maxlength="160">
      <select id="coPay"><option value="pix">Pix</option><option value="card">Cartão de crédito</option><option value="boleto">Boleto</option></select>
      <button type="submit" class="btn-primary">Finalizar pedido</button>
    </form>
    <p class="plans-note">Compra simulada: nenhum pagamento é feito.</p>`);
}

function cartQty(idx, d) {
  const i = cart[idx]; if (!i) return;
  i.qty = Math.min(20, Math.max(1, i.qty + d));
  saveCart(); openCart();
}
function cartRemove(idx) {
  cart.splice(idx, 1);
  saveCart(); openCart();
}

function checkoutOrder(e) {
  e.preventDefault();
  const cep = normCep(document.getElementById('coCep').value);
  if (cep.length !== 8) { alert('O CEP deve ter 8 números.'); return; }
  const t = cartTotals();
  const pay = { pix: 'Pix', card: 'Cartão de crédito', boleto: 'Boleto' }[document.getElementById('coPay').value];
  const order = 'PM' + Date.now().toString(36).toUpperCase().slice(-6);
  const items = cart.reduce((s, i) => s + i.qty, 0);
  cart = []; couponCode = ''; saveCart();
  openPetToolModal(`
    <div style="text-align:center;">
      <div style="font-size:3rem;">🎉</div>
      <h2>Pedido simulado realizado!</h2>
      <p>Número do pedido: <b>${order}</b></p>
      <p>${items} item(ns) • ${pay} • Total ${formatPrice(t.total)}</p>
      <p class="plans-note">Esta é uma simulação para o projeto acadêmico: nenhum pagamento foi feito e nenhum produto será enviado.</p>
      <button type="button" class="btn-primary" onclick="closePetToolModal()">Continuar comprando</button>
    </div>`);
}

async function renderCommerceLists() {
  const [p, a, d] = await Promise.all([
    sb.from('partners').select('*').order('created_at', { ascending: false }),
    sb.from('ads').select('*').order('created_at', { ascending: false }),
    sb.from('products').select('*').order('created_at', { ascending: false })
  ]);
  const partners = p.data || [], ads = a.data || [], products = d.data || [];

  const row = (title, sub, table, id, active, extra) => `
    <div class="commerce-row ${active ? '' : 'is-off'}">
      <div><b>${escapeHtml(title)}</b><br><small>${escapeHtml(sub)}</small></div>
      <div class="commerce-actions">
        ${extra || ''}
        <button class="btn-secondary" onclick="toggleCommerceActive('${table}','${id}',${!active})">${active ? 'Ocultar' : 'Mostrar'}</button>
        <button class="btn-secondary" style="color:#c0392b;" onclick="deleteCommerce('${table}','${id}')">Apagar</button>
      </div>
    </div>`;

  document.getElementById('commercePartnersList').innerHTML = partners.length ? partners.map(x => row(
    x.name, `${PARTNER_CATEGORIES[x.category] || ''} • ${x.city}${x.cep ? ' • CEP ' + formatCep(x.cep) : ''}${x.is_featured ? ' • ⭐ Destaque' : ''}`,
    'partners', x.id, x.active,
    `<button class="btn-secondary" onclick="togglePartnerFeatured('${x.id}',${!x.is_featured})">${x.is_featured ? 'Tirar destaque' : 'Destacar'}</button>`
  )).join('') : '<p style="color:#999;">Nenhum parceiro cadastrado.</p>';

  document.getElementById('commerceAdsList').innerHTML = ads.length ? ads.map(x => row(
    x.title, `${x.kind === 'prefeitura' ? 'Prefeitura' : 'Empresa'}${x.advertiser ? ' • ' + x.advertiser : ''}${x.city ? ' • ' + x.city : ' • todas as cidades'}`,
    'ads', x.id, x.active
  )).join('') : '<p style="color:#999;">Nenhum anúncio.</p>';

  document.getElementById('commerceProductsList').innerHTML = products.length ? products.map(x => row(
    x.name, `${PRODUCT_CATEGORIES[x.category] || ''} • ${formatPrice(x.price)}`,
    'products', x.id, x.active
  )).join('') : '<p style="color:#999;">Nenhum produto.</p>';

  const sel = document.getElementById('cdPartner');
  const keep = sel.value;
  sel.innerHTML = '<option value="">Sem parceiro</option>' + partners.map(x => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('');
  sel.value = keep;
}

async function saveCommerce(e, kind) {
  e.preventDefault();
  if (!currentUser || !['admin', 'supervisor'].includes(currentUser.user_type)) return;
  const val = id => document.getElementById(id).value.trim();
  let table, row;
  if (kind === 'partner') {
    const la = val('cpLat'), lo = val('cpLng');
    if ((la === '') !== (lo === '') || (la !== '' && (!(Math.abs(parseFloat(la)) <= 90) || !(Math.abs(parseFloat(lo)) <= 180)))) {
      alert('Preencha latitude e longitude juntas, com valores válidos (ou deixe as duas vazias).');
      return;
    }
  }
  if (kind === 'partner' && val('cpCep') && normCep(val('cpCep')).length !== 8) {
    alert('O CEP deve ter 8 números (ex.: 80010-000).');
    return;
  }

  if (kind === 'partner') {
    table = 'partners';
    row = {
      name: val('cpName'), category: val('cpCategory'), city: val('cpCity'),
      cep: normCep(val('cpCep')) || null,
      latitude: val('cpLat') === '' ? null : parseFloat(val('cpLat')),
      longitude: val('cpLng') === '' ? null : parseFloat(val('cpLng')),
      address: val('cpAddress') || null,
      phone: val('cpPhone') || null, description: val('cpDescription') || null,
      is_featured: document.getElementById('cpFeatured').checked
    };
  } else if (kind === 'ad') {
    table = 'ads';
    row = {
      kind: val('caKind'), title: val('caTitle'), body: val('caBody') || null,
      details: val('caDetails') || null, location: val('caLocation') || null,
      advertiser: val('caAdvertiser') || null, city: val('caCity') || null, link_url: safeLink(val('caLink')) || null
    };
  } else {
    table = 'products';
    row = {
      name: val('cdName'), category: val('cdCategory'), price: parseFloat(val('cdPrice')),
      description: val('cdDescription') || null, image_url: safeImage(val('cdImage')) || null,
      partner_id: val('cdPartner') || null
    };
    if (isNaN(row.price) || row.price < 0) { alert('Digite um preço válido.'); return; }
  }

  const { error } = await sb.from(table).insert([row]);
  if (error) { alert('Não foi possível salvar: ' + error.message); return; }
  e.target.reset();
  adsCache = null;
  renderCommerceLists();
}

async function toggleCommerceActive(table, id, active) {
  const { error } = await sb.from(table).update({ active }).eq('id', id);
  if (error) { alert('Erro: ' + error.message); return; }
  adsCache = null;
  renderCommerceLists();
}

async function togglePartnerFeatured(id, featured) {
  const { error } = await sb.from('partners').update({ is_featured: featured }).eq('id', id);
  if (error) { alert('Erro: ' + error.message); return; }
  renderCommerceLists();
}

async function deleteCommerce(table, id) {
  if (!confirm('Apagar este item? Essa ação fica registrada no log do sistema.')) return;
  const { error } = await sb.from(table).delete().eq('id', id);
  if (error) { alert('Erro: ' + error.message); return; }
  adsCache = null;
  renderCommerceLists();
}

// Explicação completa do anúncio (o que é, quem anuncia, onde fica, como chegar)
function openAdModal(adId) {
  const ad = (adsCache || []).find(a => a.id === adId);
  if (!ad) return;
  const link = safeLink(ad.link_url);
  const where = ad.location || '';
  const mapsUrl = where ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(where + (ad.city ? ', ' + ad.city : '')) : '';
  document.getElementById('adModalContent').innerHTML = `
    <span class="ad-tag">${ad.kind === 'prefeitura' ? '🏛️ Campanha da prefeitura' : '📢 Anúncio de empresa parceira'}</span>
    <h2 style="color:var(--primary-blue); margin:0.5rem 0;">${escapeHtml(ad.title)}</h2>
    ${ad.advertiser ? `<p><strong>Quem anuncia:</strong> ${escapeHtml(ad.advertiser)}</p>` : ''}
    <p>${escapeHtml(ad.details || ad.body || 'Sem mais detalhes.')}</p>
    <p><strong>Onde:</strong> ${escapeHtml(where || (ad.city ? ad.city : 'Todas as cidades'))}</p>
    <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:1rem;">
      ${mapsUrl ? `<a class="btn-primary" style="text-decoration:none;" href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer">Ver no mapa</a>` : ''}
      ${link ? `<a class="btn-secondary" style="text-decoration:none;" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Site do anúncio</a>` : ''}
    </div>`;
  document.getElementById('adModal').classList.add('active');
}

function closeAdModal() {
  document.getElementById('adModal').classList.remove('active');
}

// ----- Localização do usuário (só no aparelho, não é enviada nem guardada) -----
let userPos = null;

function distanceKm(p) {
  if (!userPos || p.latitude == null || p.longitude == null) return Infinity;
  const rad = d => d * Math.PI / 180;
  const dLat = rad(p.latitude - userPos.lat), dLng = rad(p.longitude - userPos.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(userPos.lat)) * Math.cos(rad(p.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatKm(km) {
  return km < 1 ? Math.round(km * 1000) + ' m' : km.toFixed(1).replace('.', ',') + ' km';
}

function useMyLocation() {
  const status = document.getElementById('geoStatus');
  if (!navigator.geolocation) {
    status.textContent = 'Este navegador não permite usar a localização.';
    return;
  }
  status.textContent = 'Aguardando a sua permissão...';
  navigator.geolocation.getCurrentPosition(pos => {
    userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    status.textContent = 'Mostrando os parceiros mais próximos. A localização não é guardada.';
    document.getElementById('geoBtn').textContent = '📍 Atualizar localização';
    document.getElementById('geoStopBtn').style.display = '';
    renderPartners();
  }, err => {
    status.textContent = err.code === 1
      ? 'Você não permitiu a localização. Para usar, permita nas configurações do navegador e toque no botão de novo.'
      : 'Não foi possível obter a localização agora. Tente de novo.';
  }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
}

function stopUsingLocation() {
  userPos = null;
  document.getElementById('geoBtn').textContent = '📍 Usar minha localização';
  document.getElementById('geoStopBtn').style.display = 'none';
  document.getElementById('geoStatus').textContent = 'O navegador vai perguntar se você permite. A localização é usada só para calcular a distância e não é guardada.';
  renderPartners();
}

// ============================================================================
// ADOTADOR: compatibilidade (espécie, porte e energia)
// ============================================================================

function matchPrefs() {
  return (currentUser && currentUser.user_type === 'adopter' && currentUser.match_prefs) || {};
}

function hasMatchPrefs() {
  const p = matchPrefs();
  return !!(p.type || p.size || p.energy);
}

// Calcula o quanto o pet combina com o que o adotador procura (estimativa)
function petCompat(pet) {
  if (!hasMatchPrefs()) return null;
  const p = matchPrefs();
  const energy = pet.energy || 'Moderada';
  const sizes = ['small', 'medium', 'large'];
  const parts = [];
  if (p.type) parts.push({ w: 40, r: p.type === pet.type ? 1 : 0, ok: 'É da espécie que você procura.', bad: 'Não é a espécie que você procura.' });
  if (p.size) parts.push({ w: 35, r: p.size === pet.size ? 1 : (Math.abs(sizes.indexOf(p.size) - sizes.indexOf(pet.size)) === 1 ? 0.5 : 0), ok: 'O porte é o que você procura.', bad: 'O porte é diferente do que você procura.' });
  if (p.energy) parts.push({ w: 25, r: p.energy === energy ? 1 : (p.energy === 'Moderada' || energy === 'Moderada' ? 0.5 : 0), ok: 'A energia combina com a sua.', bad: 'A energia é diferente da que você procura.' });
  const max = parts.reduce((s, x) => s + x.w, 0);
  if (!max) return null;
  const score = Math.round(parts.reduce((s, x) => s + x.w * x.r, 0) / max * 100);
  return { score, reasons: parts.map(x => ({ ok: x.r >= 0.7, text: x.r >= 0.7 ? x.ok : x.bad })) };
}

function compatDetailHtml(pet) {
  if (!currentUser || currentUser.user_type !== 'adopter') return '';
  const c = petCompat(pet);
  if (!c) return '<p style="text-align:center;"><a href="#" onclick="closePetDetailModal(); showPage(\'compat\'); return false;">💚 Diga o que você procura e veja a compatibilidade</a></p>';
  return `<div class="compat-box"><h3 style="margin-top:0;">💚 ${c.score}% compatível</h3><ul class="compat-reasons">${c.reasons.map(r => `<li>${r.ok ? '✅' : '⚠️'} ${escapeHtml(r.text)}</li>`).join('')}</ul></div>`;
}

function loadCompatForm() {
  const p = matchPrefs();
  document.getElementById('cpType').value = p.type || '';
  document.getElementById('cpSize').value = p.size || '';
  document.getElementById('cpEnergy').value = p.energy || '';
}

async function saveCompat(e) {
  e.preventDefault();
  const prefs = {
    type: document.getElementById('cpType').value,
    size: document.getElementById('cpSize').value,
    energy: document.getElementById('cpEnergy').value
  };
  Object.keys(prefs).forEach(k => { if (!prefs[k]) delete prefs[k]; });
  const { error } = await sb.from('profiles').update({ match_prefs: prefs }).eq('id', currentUser.id);
  if (error) { alert('Erro ao salvar: ' + error.message); return; }
  currentUser = { ...currentUser, match_prefs: prefs };
  alert('Preferências salvas! Os pets agora mostram a compatibilidade.');
  showPage('pets');
}

function closePetToolModal() {
  document.getElementById('petToolModal').classList.remove('active');
}

function openPetToolModal(html) {
  document.getElementById('petToolContent').innerHTML = html;
  document.getElementById('petToolModal').classList.add('active');
}

// ============================================================================
// PREFEITURA e EMPRESA: painel próprio
// ============================================================================

const STATUS_CONTENT = { pending: ['⏳ Em análise', '#d9822b'], approved: ['✔ Publicado', 'var(--primary-green)'], rejected: ['✖ Recusado', '#c0392b'] };
function statusBadge(s) {
  const [txt, color] = STATUS_CONTENT[s] || [s, '#999'];
  return `<span style="background:${color}; color:#fff; font-size:0.7rem; padding:2px 9px; border-radius:999px;">${txt}</span>`;
}

function ownRow(table, x, title, sub) {
  return `<div class="commerce-row ${x.active ? '' : 'is-off'}"><div><b>${escapeHtml(title)}</b> ${statusBadge(x.status)}<br><small>${escapeHtml(sub)}</small></div>
    <div class="commerce-actions">
      <button class="btn-secondary" onclick="orgToggle('${table}','${x.id}',${!x.active})">${x.active ? 'Ocultar' : 'Mostrar'}</button>
      <button class="btn-secondary" style="color:#c0392b;" onclick="orgDelete('${table}','${x.id}')">Apagar</button></div></div>`;
}

async function orgToggle(table, id, active) {
  const { error } = await sb.from(table).update({ active }).eq('id', id);
  if (error) { alert('Erro: ' + error.message); return; }
  loadOrgPanel();
}
async function orgDelete(table, id) {
  if (!confirm('Apagar definitivamente?')) return;
  const { error } = await sb.from(table).delete().eq('id', id);
  if (error) { alert('Erro: ' + error.message); return; }
  loadOrgPanel();
}

function adFormHtml(kind) {
  return `<form onsubmit="saveOwnAd(event, '${kind}')" class="commerce-form">
    <input type="text" id="oaTitle" placeholder="Título (ex.: Castração gratuita)" maxlength="120" required>
    <input type="text" id="oaBody" placeholder="Resumo curto" maxlength="200">
    <input type="text" id="oaDetails" placeholder="Explicação completa (quem pode, como funciona, documentos)" maxlength="1500">
    <input type="text" id="oaLocation" placeholder="Local de atendimento (endereço)" maxlength="200">
    <input type="text" id="oaCity" placeholder="Cidade do anúncio" value="${escapeHtml(currentUser.city || '')}" maxlength="80">
    <input type="url" id="oaLink" placeholder="Link (opcional, https://...)">
    <button class="btn-primary" type="submit">Enviar para aprovação</button></form>`;
}

async function saveOwnAd(e, kind) {
  e.preventDefault();
  const val = id => document.getElementById(id).value.trim();
  const row = { kind, title: val('oaTitle'), body: val('oaBody') || null, details: val('oaDetails') || null, location: val('oaLocation') || null,
    advertiser: currentUser.name, city: val('oaCity') || null, link_url: safeLink(val('oaLink')) || null };
  const { error } = await sb.from('ads').insert([{ ...row, owner_id: currentUser.id }]);
  if (error) { alert('Não foi possível enviar: ' + error.message); return; }
  alert('Anúncio enviado! Ele aparece no site depois que o Supervisor ou o Administrador aprovar.');
  loadOrgPanel();
}

async function loadOrgPanel() {
  const el = document.getElementById('orgPanelContent');
  const role = currentUser.user_type;
  document.getElementById('orgPanelTitle').textContent = role === 'prefeitura' ? 'Painel da Prefeitura' : 'Painel da Empresa';
  el.innerHTML = '<p style="color:#999;">Carregando...</p>';
  const mine = async table => (await sb.from(table).select('*').eq('owner_id', currentUser.id).order('created_at', { ascending: false })).data || [];
  const head = `<p class="compat-lock" style="background:#f2f7ff; border-color:#cfe0fb; color:#245;">Tudo o que você publica passa por aprovação do Supervisor ou do Administrador antes de aparecer no site.</p>`;

  if (role === 'prefeitura') {
    const ads = await mine('ads');
    const { data, error } = await sb.rpc('city_stats', { p_city: currentUser.city });
    const stats = error ? `<p class="compat-lock">${escapeHtml(error.message)}</p>` : `<h3>Indicadores de ${escapeHtml(data.city)}</h3><div class="dashboard-stats">
      <div class="stat-card"><h4>Pets disponíveis</h4><p class="stat-number">${data.pets_available}</p></div>
      <div class="stat-card"><h4>Pets adotados</h4><p class="stat-number">${data.pets_adopted}</p></div>
      <div class="stat-card"><h4>ONGs na cidade</h4><p class="stat-number">${data.ongs}</p></div>
      <div class="stat-card"><h4>Adotadores</h4><p class="stat-number">${data.adopters}</p></div>
      <div class="stat-card"><h4>Solicitações</h4><p class="stat-number">${data.requests}</p></div>
      <div class="stat-card"><h4>Adoções concluídas</h4><p class="stat-number">${data.completed}</p></div></div>`;
    const { data: ongs } = currentUser.city ? await sb.from('profiles').select('id, name, phone').eq('user_type', 'ong').ilike('city', currentUser.city) : { data: [] };
    el.innerHTML = head + stats + `<h3>ONGs da cidade</h3>` + ((ongs || []).map(o => `<div class="commerce-row"><div><b>${escapeHtml(o.name)}</b><br><small>${escapeHtml(o.phone || '')}</small></div><button class="btn-secondary" onclick="showOngPublic('${o.id}')">Ver página</button></div>`).join('') || '<p style="color:#888;">Nenhuma ONG cadastrada na sua cidade.</p>') +
      `<h3>Novo anúncio (campanhas, castração, vacinação)</h3>` + adFormHtml('prefeitura') +
      `<h3>Meus anúncios e desempenho</h3>` + (ads.map(x => ownRow('ads', x, x.title, `👁 ${x.views || 0} visualizações • 👆 ${x.clicks || 0} cliques`)).join('') || '<p style="color:#888;">Nenhum anúncio ainda.</p>');
    return;
  }

  // Empresa
  const [partners, products, ads] = await Promise.all([mine('partners'), mine('products'), mine('ads')]);
  el.innerHTML = head + `
    <h3>Minha empresa no mapa de parceiros</h3>
    <form onsubmit="saveOwnPartner(event)" class="commerce-form">
      <input type="text" id="opName" placeholder="Nome da empresa" required maxlength="120">
      <select id="opCategory">${Object.entries(PARTNER_CATEGORIES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <input type="text" id="opCity" placeholder="Cidade" required value="${escapeHtml(currentUser.city || '')}">
      <input type="text" id="opCep" placeholder="CEP" inputmode="numeric" maxlength="9">
      <input type="number" id="opLat" placeholder="Latitude (opcional)" step="any" min="-90" max="90">
      <input type="number" id="opLng" placeholder="Longitude (opcional)" step="any" min="-180" max="180">
      <input type="text" id="opAddress" placeholder="Endereço">
      <input type="text" id="opPhone" placeholder="Telefone">
      <input type="text" id="opDesc" placeholder="Descrição curta" maxlength="300">
      <button class="btn-primary" type="submit">Enviar para aprovação</button></form>
    ${partners.map(x => ownRow('partners', x, x.name, `${PARTNER_CATEGORIES[x.category] || ''} • ${x.city} • 👁 ${x.views || 0} visualizações`)).join('')}
    <h3>Meus produtos na loja</h3>
    <form onsubmit="saveOwnProduct(event)" class="commerce-form">
      <input type="text" id="oprName" placeholder="Nome do produto" required maxlength="120">
      <select id="oprCategory">${Object.entries(PRODUCT_CATEGORIES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <input type="number" id="oprPrice" placeholder="Preço (R$)" step="0.01" min="0" required>
      <input type="text" id="oprDesc" placeholder="Descrição" maxlength="300">
      <input type="text" id="oprImage" placeholder="Imagem: https://... ou images/nome.png">
      <select id="oprPartner"><option value="">Sem empresa</option>${partners.filter(p => p.status === 'approved').map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}</select>
      <button class="btn-primary" type="submit">Enviar para aprovação</button></form>
    ${products.map(x => ownRow('products', x, x.name, `${PRODUCT_CATEGORIES[x.category] || ''} • ${formatPrice(x.price)}`)).join('')}
    <h3>Meus anúncios</h3>
    ${adFormHtml('empresa')}
    ${ads.map(x => ownRow('ads', x, x.title, `👁 ${x.views || 0} visualizações • 👆 ${x.clicks || 0} cliques`)).join('')}`;
}

async function saveOwnPartner(e) {
  e.preventDefault();
  const val = id => document.getElementById(id).value.trim();
  const cep = normCep(val('opCep'));
  if (cep && cep.length !== 8) { alert('O CEP deve ter 8 números.'); return; }
  const la = val('opLat'), lo = val('opLng');
  if ((la === '') !== (lo === '')) { alert('Preencha latitude e longitude juntas.'); return; }
  const row = { name: val('opName'), category: val('opCategory'), city: val('opCity'), cep: cep || null,
    latitude: la === '' ? null : parseFloat(la), longitude: lo === '' ? null : parseFloat(lo),
    address: val('opAddress') || null, phone: val('opPhone') || null, description: val('opDesc') || null,
    owner_id: currentUser.id };
  const { error } = await sb.from('partners').insert([row]);
  if (error) { alert('Não foi possível enviar: ' + error.message); return; }
  alert('Enviado! Aparece no site depois da aprovação.');
  loadOrgPanel();
}

async function saveOwnProduct(e) {
  e.preventDefault();
  const val = id => document.getElementById(id).value.trim();
  const price = parseFloat(val('oprPrice'));
  if (isNaN(price) || price < 0) { alert('Digite um preço válido.'); return; }
  const row = { name: val('oprName'), category: val('oprCategory'), price, description: val('oprDesc') || null,
    image_url: safeImage(val('oprImage')) || null, partner_id: val('oprPartner') || null, owner_id: currentUser.id };
  const { error } = await sb.from('products').insert([row]);
  if (error) { alert('Não foi possível enviar: ' + error.message); return; }
  alert('Enviado! Aparece na loja depois da aprovação.');
  loadOrgPanel();
}

// ============================================================================
// SUPERVISOR / ADMIN: aprovações e visão geral
// ============================================================================
async function renderApprovals() {
  const el = document.getElementById('approvalsList');
  el.innerHTML = '<p style="color:#999;">Carregando...</p>';
  const [p, a, d] = await Promise.all(['partners', 'ads', 'products'].map(tb => sb.from(tb).select('*').eq('status', 'pending').order('created_at')));
  const items = [
    ...(p.data || []).map(x => ({ table: 'partners', x, title: x.name, sub: `Empresa parceira • ${PARTNER_CATEGORIES[x.category] || ''} • ${x.city}`, text: x.description })),
    ...(a.data || []).map(x => ({ table: 'ads', x, title: x.title, sub: `Anúncio (${x.kind}) • ${x.advertiser || ''} • ${x.city || 'todas as cidades'}`, text: [x.body, x.details, x.location].filter(Boolean).join(' — ') })),
    ...(d.data || []).map(x => ({ table: 'products', x, title: x.name, sub: `Produto • ${PRODUCT_CATEGORIES[x.category] || ''} • ${formatPrice(x.price)}`, text: x.description }))
  ];
  el.innerHTML = items.map(i => `<div class="commerce-row"><div><b>${escapeHtml(i.title)}</b><br><small>${escapeHtml(i.sub)}</small>${i.text ? `<p style="margin:0.3rem 0 0;">${escapeHtml(i.text)}</p>` : ''}</div>
    <div class="commerce-actions"><button class="btn-primary" onclick="reviewContent('${i.table}','${i.x.id}','approved')">Aprovar</button>
    <button class="btn-secondary" onclick="reviewContent('${i.table}','${i.x.id}','rejected')">Recusar</button></div></div>`).join('') || '<p style="color:#888; text-align:center;">Nada esperando aprovação. 🎉</p>';
}

async function reviewContent(table, id, status) {
  const { error } = await sb.from(table).update({ status }).eq('id', id);
  if (error) { alert('Erro: ' + error.message); return; }
  renderApprovals();
}

async function renderOverview() {
  const el = document.getElementById('overviewContent');
  el.innerHTML = '<p style="color:#999;">Carregando...</p>';
  const { data, error } = await sb.rpc('admin_overview');
  if (error) { el.innerHTML = `<p class="compat-lock">${escapeHtml(error.message)}</p>`; return; }
  const card = (h, n) => `<div class="stat-card"><h4>${h}</h4><p class="stat-number">${n}</p></div>`;
  const users = data.users || {};
  el.innerHTML = `<div class="dashboard-stats">
    ${card('Adotadores', users.adopter || 0)}${card('ONGs', users.ong || 0)}${card('Prefeituras', users.prefeitura || 0)}${card('Empresas', users.empresa || 0)}
    ${card('Pets', data.pets)}${card('Solicitações', data.requests)}${card('Adoções concluídas', data.completed)}${card('Conteúdos para aprovar', data.pending_content)}</div>`;
}

// ============================================================================
// RECUPERAÇÃO DE SENHA
// ============================================================================
let recoveryCooldown = false;

function openForgotPassword() {
  const typed = document.getElementById('loginEmail')?.value.trim() || '';
  closeAuthModal();
  openPetToolModal(`
    <h2>Recuperar senha</h2>
    <p>Digite o e-mail da sua conta. Enviaremos um link para você criar uma nova senha.</p>
    <form onsubmit="sendRecovery(event)">
      <div class="form-group"><label>Email</label><input type="email" id="recEmail" placeholder="seu@email.com" required value="${escapeHtml(typed)}"></div>
      <button class="btn-primary" id="recBtn" type="submit" style="width:100%;">Enviar link</button>
    </form>
    <p class="plans-note">Não lembra o e-mail? Fale com a equipe: contato@petmatch.com (informe nome e cidade).</p>`);
}

async function sendRecovery(e) {
  e.preventDefault();
  if (recoveryCooldown) return;
  const email = document.getElementById('recEmail').value.trim();
  if (!isValidEmail(email)) { alert('Digite um e-mail válido.'); return; }
  recoveryCooldown = true;
  const btn = document.getElementById('recBtn');
  btn.disabled = true;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  setTimeout(() => { recoveryCooldown = false; }, 60000);
  if (error && /rate|limit|seconds/i.test(error.message || '')) {
    alert('Muitas tentativas. Aguarde alguns minutos e tente de novo.');
    btn.disabled = false;
    recoveryCooldown = false;
    return;
  }
  // mesma resposta exista ou não a conta, para não revelar quem está cadastrado
  openPetToolModal(`<h2>Verifique seu e-mail</h2>
    <p>Se existir uma conta com <b>${escapeHtml(email)}</b>, enviamos um link para criar uma nova senha. Ele vale por pouco tempo.</p>
    <p class="plans-note">Não chegou? Olhe o spam e espere alguns minutos antes de tentar de novo.</p>
    <button class="btn-primary" type="button" onclick="closePetToolModal()">Entendi</button>`);
}

function openNewPassword() {
  openPetToolModal(`
    <h2>Criar nova senha</h2>
    <form onsubmit="saveNewPassword(event)">
      <div class="form-group"><label>Nova senha</label><input type="password" id="newPass1" minlength="6" required placeholder="Mínimo 6 caracteres"></div>
      <div class="form-group"><label>Repita a nova senha</label><input type="password" id="newPass2" minlength="6" required></div>
      <button class="btn-primary" type="submit" style="width:100%;">Salvar nova senha</button>
    </form>`);
}

async function saveNewPassword(e) {
  e.preventDefault();
  const p1 = document.getElementById('newPass1').value, p2 = document.getElementById('newPass2').value;
  if (p1.length < 6) { alert('A senha precisa ter pelo menos 6 caracteres.'); return; }
  if (p1 !== p2) { alert('As senhas não são iguais.'); return; }
  const { error } = await sb.auth.updateUser({ password: p1 });
  if (error) { alert('Não foi possível trocar a senha: ' + error.message + '\nPeça um novo link em "Esqueci minha senha".'); return; }
  recoveryPending = false;
  await sb.auth.signOut();
  currentUser = null;
  updateHeader();
  try { history.replaceState(null, '', location.pathname + location.search); } catch (err) { /* ignora */ }
  closePetToolModal();
  alert('Senha alterada! Entre com a nova senha.');
  openAuthModal();
}

// O link do e-mail traz o usuário de volta ao site: abre a tela da nova senha
document.addEventListener('DOMContentLoaded', () => {
  if (recoveryPending) setTimeout(openNewPassword, 400);
  if (sb.auth.onAuthStateChange) {
    sb.auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY') { recoveryPending = true; setTimeout(openNewPassword, 200); }
    });
  }
});

// ----- Alterar senha (usuário logado) -----
function openChangePassword() {
  if (!currentUser) { openAuthModal(); return; }
  document.getElementById('profileMenu').style.display = 'none';
  openPetToolModal(`
    <h2>Alterar senha</h2>
    <form onsubmit="saveChangedPassword(event)">
      <div class="form-group"><label>Senha atual</label><input type="password" id="oldPass" required autocomplete="current-password"></div>
      <div class="form-group"><label>Nova senha</label><input type="password" id="chgPass1" minlength="6" required placeholder="Mínimo 6 caracteres" autocomplete="new-password"></div>
      <div class="form-group"><label>Repita a nova senha</label><input type="password" id="chgPass2" minlength="6" required autocomplete="new-password"></div>
      <button class="btn-primary" type="submit" style="width:100%;">Salvar nova senha</button>
    </form>`);
}

async function saveChangedPassword(e) {
  e.preventDefault();
  const oldPass = document.getElementById('oldPass').value;
  const p1 = document.getElementById('chgPass1').value, p2 = document.getElementById('chgPass2').value;
  if (p1.length < 6) { alert('A nova senha precisa ter pelo menos 6 caracteres.'); return; }
  if (p1 !== p2) { alert('As senhas novas não são iguais.'); return; }
  if (p1 === oldPass) { alert('A nova senha precisa ser diferente da atual.'); return; }
  const check = await sb.auth.signInWithPassword({ email: currentUser.email, password: oldPass });
  if (check.error) { alert('A senha atual está incorreta.'); return; }
  const { error } = await sb.auth.updateUser({ password: p1 });
  if (error) { alert('Não foi possível trocar a senha: ' + error.message); return; }
  closePetToolModal();
  alert('Senha alterada com sucesso!');
}
