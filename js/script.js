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
      const plan = planOf(currentUser);
      roleLabel.textContent = '🏷️ ' + getRoleLabel(currentUser.user_type) + (plan !== 'free' ? ' · ⭐ ' + PLAN_LABELS[plan] : '');
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
  } else if (page === 'plans') {
    markCurrentPlan();
  } else if (page === 'org-panel') {
    if (!currentUser || !['prefeitura', 'empresa'].includes(currentUser.user_type)) {
      alert('Este painel é para Prefeituras e Empresas.');
      showPage('home');
      return;
    }
    loadOrgPanel();
  } else if (page === 'events') {
    loadEventsPage();
  } else if (page === 'my-pets') {
    if (!currentUser || currentUser.user_type !== 'adopter') {
      alert('Meus Pets é para adotadores.');
      showPage('home');
      return;
    }
    loadMyPetsPage();
  } else if (page === 'compat') {
    if (!currentUser || currentUser.user_type !== 'adopter') {
      alert('Faça login como adotador para ver a compatibilidade.');
      showPage('home');
      return;
    }
    loadCompatForm();
  } else if (page === 'my-plan') {
    if (!currentUser) {
      alert('Faça login para ver o seu plano.');
      showPage('plans');
      return;
    }
    loadMyPlanPage();
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
    const { data: ongs } = await sb.from('profiles').select('id, name, plan, plan_expires_at, pix_key, pix_name').in('id', ongIds);
    const ongById = Object.fromEntries((ongs || []).map(o => [o.id, o]));
    allPets = allPets.map(pet => {
      const ong = ongById[pet.ong_id];
      return { ...pet, ongName: ong ? ong.name : 'ONG não identificada', ongPlan: planOf(ong), ongPix: ong ? ong.pix_key : null, ongPixName: ong ? ong.pix_name : null };
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

  // Pets cadastrados nas últimas 24 horas aparecem primeiro para o Adotador Plus
  if (!canSeeNewPets()) pets = pets.filter(p => !isNewPet(p));

  // ONG Premium: pets em destaque no topo; depois, os mais compatíveis (se o adotador pedir)
  const wantCompat = document.getElementById('filterCompat')?.checked;
  pets = pets.map((p, i) => ({ p, i })).sort((a, b) => {
    const fa = a.p.ongPlan === 'premium' ? 1 : 0, fb = b.p.ongPlan === 'premium' ? 1 : 0;
    if (wantCompat) {
      const ca = petCompat(a.p), cb = petCompat(b.p);
      const d = (cb ? cb.score : -1) - (ca ? ca.score : -1);
      if (d) return d;
    }
    return (fb - fa) || (a.i - b.i);
  }).map(x => x.p);
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
    pet.ongPlan === 'premium' ? '<span class="pet-badge pet-badge-gold">⭐ Destaque</span>' : '',
    isNewPet(pet) ? '<span class="pet-badge pet-badge-new">🆕 Novo</span>' : '',
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
      <div class="pet-details">🏠 ${escapeHtml(pet.ongName || 'ONG não identificada')}${['essencial', 'premium'].includes(pet.ongPlan) ? ' <span class="ong-verified" title="ONG Verificada">✔ ONG Verificada</span>' : ''}</div>
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
      <p><strong>ONG responsável:</strong> ${escapeHtml(pet.ongName || 'Não identificada')}${['essencial', 'premium'].includes(pet.ongPlan) ? ' <span class="ong-verified">✔ ONG Verificada</span>' : ''}</p>
      ${pet.ongPlan === 'premium' && pet.ongPix ? `<p><strong>Apoiar a ONG (Pix):</strong> <code>${escapeHtml(pet.ongPix)}</code> <button class="btn-secondary" style="padding:2px 10px;" onclick="copyText(${jsStr(pet.ongPix)})">Copiar</button></p>` : ''}
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
  } else if (tab === 'promo') {
    renderPromoTab();
  } else if (tab === 'events') {
    renderOngEventsTab();
  } else if (tab === 'reports') {
    renderReportsTab();
  } else if (tab === 'team') {
    renderTeamTab();
  }
}

async function updateAdminDashboard() {
  if (!currentUser) return;
  const ongId = ongScopeId();
  renderOngBanner();

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
    .eq('ong_id', ongScopeId())
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
    name, type, breed, age, size, energy, city, cep: cep || null, ong_id: ongScopeId(),
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
    .eq('pets.ong_id', ongScopeId())
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
  const { data: adopters } = await sb.from('profiles').select('id, name, email, phone, city, is_verified, plan, plan_expires_at').in('id', adopterIds);
  const adopterById = Object.fromEntries((adopters || []).map(a => [a.id, a]));

  list.innerHTML = requests.map(req => {
    const a = adopterById[req.adopter_id] || {};
    return `
    <div style="background: var(--light-bg); padding: 1.5rem; border-radius: 12px; margin-bottom: 1rem;">
      <h4>${escapeHtml(req.pets.name)}</h4>
      <p><strong>Adotador:</strong> ${escapeHtml(a.name || 'Desconhecido')}${a.is_verified ? ' <span style="color: var(--primary-green); font-size:0.8rem;">✔ Verificado</span>' : ''}${hasPlan(a, 'plus') ? ' <span class="plus-seal">⭐ Adotador Plus</span>' : ''}</p>
      <p><strong>E-mail:</strong> ${escapeHtml(a.email || '—')}</p>
      <p><strong>Telefone:</strong> ${escapeHtml(a.phone || 'Não informado')}</p>
      <p><strong>Cidade:</strong> ${escapeHtml(a.city || 'Não informada')}</p>
      <p><strong>Status:</strong> ${escapeHtml(STATUS_LABELS[req.status] || req.status)}</p>
      <div style="display:flex; gap:0.5rem; margin-top:1rem; flex-wrap:wrap;">
        <button class="btn-secondary" onclick="showProfileDetails('${req.adopter_id}')">Ver perfil completo</button>
        <button class="btn-secondary" onclick="showRequestHistory('${req.id}', ${jsStr(req.pets.name)})">Ver histórico</button>
        ${['essencial', 'premium'].includes(ongPlan()) ? `<button class="btn-secondary" onclick="openRequestChat('${req.id}', ${jsStr(req.pets.name)}, 'ong')">💬 Conversar</button>` : ''}
        ${ongPlan() === 'premium' ? `<button class="btn-secondary" onclick="openRequestNotes('${req.id}', ${jsStr(req.pets.name)})">📋 Acompanhamento</button>` : ''}
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
  if (ongPlan() === 'premium') {
    visitRow.kind = confirm('É uma ENTREVISTA? (OK = entrevista, Cancelar = visita)') ? 'interview' : 'visit';
    visitRow.location = (prompt('Local ou link do encontro (opcional):') || '').trim() || null;
  }
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
    .select('id, scheduled_date, notes, kind, status, location, adoption_requests!inner(pet_id, pets!inner(name, ong_id))')
    .eq('adoption_requests.pets.ong_id', ongScopeId())
    .order('scheduled_date', { ascending: true });

  if (error) {
    list.innerHTML = `<p style="text-align:center; color:#999;">Erro: ${error.message}</p>`;
    return;
  }

  if (!visits || visits.length === 0) {
    list.innerHTML = '<p style="text-align:center; color:#999;">Nenhuma visita agendada.</p>';
    return;
  }

  const VSTATUS = { scheduled: 'Agendada', done: 'Realizada', cancelled: 'Cancelada' };
  const premium = ongPlan() === 'premium';
  list.innerHTML = visits.map(v => `
    <div style="background: var(--light-bg); padding: 1.5rem; border-radius: 12px; margin-bottom: 1rem;">
      <h4>${escapeHtml(v.adoption_requests.pets.name)} ${v.kind === 'interview' ? '<span class="pet-badge">🎤 Entrevista</span>' : ''}</h4>
      <p><strong>Data:</strong> ${new Date(v.scheduled_date).toLocaleString()}</p>
      ${v.location ? `<p><strong>Local:</strong> ${escapeHtml(v.location)}</p>` : ''}
      ${premium ? `<p><strong>Situação:</strong> ${VSTATUS[v.status] || v.status}</p>
        ${v.status === 'scheduled' ? `<button class="btn-secondary" onclick="setVisitStatus('${v.id}', 'done')">Marcar como realizada</button> <button class="btn-secondary" onclick="setVisitStatus('${v.id}', 'cancelled')">Cancelar</button>` : ''}` : ''}
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
        ${isAdmin && PLAN_FOR_ROLE_ADMIN[u.user_type] ? `<select onchange="adminChangePlan('${u.id}', this.value)" title="Plano">${PLAN_FOR_ROLE_ADMIN[u.user_type].map(p => `<option value="${p}" ${planOf(u) === p ? 'selected' : ''}>${PLAN_LABELS[p] || p}</option>`).join('')}</select>` : (planOf(u) !== 'free' ? `<span class="plus-seal">${escapeHtml(PLAN_LABELS[planOf(u)] || planOf(u))}</span>` : '')}
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

  let query = sb.from('complaints').select('*').order('priority', { ascending: false }).order('created_at', { ascending: false }).limit(100);
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
        <strong>${c.priority ? '⭐ ' : ''}${escapeHtml(c.subject)}</strong>${c.priority ? ' <span class=plus-seal>Prioridade</span>' : ''}
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


// ===== PLANOS / ASSINATURAS (simulação) =====
function setPlanAudience(aud) {
  const ong = aud === 'ong';
  document.getElementById('audAdopter').classList.toggle('active', !ong);
  document.getElementById('audOng').classList.toggle('active', ong);
  document.getElementById('plansAdopter').style.display = ong ? 'none' : '';
  document.getElementById('plansOng').style.display = ong ? '' : 'none';
}

// ===== PLANOS: assinatura simulada (ativa por 1 ano, sem cobrança) =====
const PLAN_LABELS = {
  free: 'Grátis', plus: 'Adotador Plus', essencial: 'ONG Essencial', premium: 'ONG Premium',
  parceira: 'Empresa Parceira', institucional: 'Prefeitura Institucional'
};
const PLAN_PRICES = { plus: 49.9, essencial: 119.9, premium: 199.9, parceira: 499 };
const PLAN_FOR_ROLE = { adopter: ['plus'], ong: ['essencial', 'premium'], empresa: ['parceira'] };
const PLAN_FEATURES = {
  plus: ['Compatibilidade avançada', 'Meus Pets: carteirinha digital, histórico de saúde, lembretes e diário de evolução', 'Acompanhamento pós-adoção', 'Selo Adotador Plus no perfil', 'Pets novos 24 horas antes', '10% de desconto na lojinha e descontos em parceiros', 'Sem anúncios', 'Suporte prioritário'],
  essencial: ['Mensagens com interessados e adotantes', 'Estatísticas básicas', 'Selo ONG Verificada', 'Link próprio da ONG', 'Card pronto de cada pet para compartilhar', 'Limite de 30 pets', 'Suporte prioritário'],
  premium: ['Tudo do Essencial', 'Relatórios completos de adoção', 'Painel de desempenho', 'Visitas e entrevistas', 'Acompanhamento dos adotantes', 'Pets em destaque no topo', 'Equipe com mais administradores', 'Doações por Pix', 'Modelos de termo de adoção e questionário', 'Eventos de adoção', 'Limite de 100 pets'],
  parceira: ['Destaque automático em Parceiros', 'Até 5 parceiros e 30 produtos', 'Anúncios (até 10)', 'Desconto para quem tem Adotador Plus', 'Desempenho: visualizações e cliques'],
  institucional: ['Até 50 anúncios e campanhas', 'Indicadores do município', 'Desempenho das campanhas']
};

// Plano que vale hoje (plano vencido volta a ser grátis)
function planOf(user) {
  if (!user) return 'free';
  const plan = user.plan || 'free';
  if (plan === 'free') return 'free';
  if (user.plan_expires_at && new Date(user.plan_expires_at) < new Date()) return 'free';
  return plan;
}

function hasPlan(user, ...plans) {
  return plans.includes(planOf(user));
}

// Equipe da ONG: quem é administrador extra trabalha na conta da ONG dona
let ongScope = null;

async function loadOngScope() {
  ongScope = null;
  if (!currentUser || currentUser.user_type !== 'ong') return;
  const { data } = await sb.from('ong_members').select('ong_id').eq('member_id', currentUser.id);
  if (data && data.length) {
    const { data: owner } = await sb.from('profiles').select('*').eq('id', data[0].ong_id).single();
    if (owner) { ongScope = { id: owner.id, profile: owner, isMember: true }; return; }
  }
  ongScope = { id: currentUser.id, profile: currentUser, isMember: false };
}

function ongScopeId() {
  return ongScope ? ongScope.id : (currentUser ? currentUser.id : null);
}

function ongPlan() {
  return planOf(ongScope ? ongScope.profile : currentUser);
}

function isOngMember() {
  return !!(ongScope && ongScope.isMember);
}

async function afterAuth() {
  await loadOngScope();
  if (typeof afterAuthExtras === 'function') await afterAuthExtras();
}

async function refreshCurrentUser() {
  if (!currentUser) return;
  const { data } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  if (data) currentUser = data;
  await loadOngScope();
  updateHeader();
}

async function subscribePlan(planKey) {
  if (!currentUser) {
    alert('Entre ou crie uma conta para assinar um plano.');
    openAuthModal();
    return;
  }
  if (!(PLAN_FOR_ROLE[currentUser.user_type] || []).includes(planKey)) {
    alert(`O plano ${PLAN_LABELS[planKey]} não é para contas do tipo "${getRoleLabel(currentUser.user_type)}".`);
    return;
  }
  if (isOngMember()) {
    alert('Quem assina é a conta principal da ONG.');
    return;
  }
  if (!confirm(`Ativar o plano ${PLAN_LABELS[planKey]} por ${formatPrice(PLAN_PRICES[planKey])} ao ano?\n\nO pagamento é uma simulação: nada será cobrado.`)) return;
  const { error } = await sb.rpc('subscribe_plan', { p_plan: planKey });
  if (error) { alert('Não foi possível ativar o plano: ' + error.message); return; }
  await refreshCurrentUser();
  alert(`Plano ${PLAN_LABELS[planKey]} ativado! Os recursos já estão liberados.`);
  showPage('my-plan');
}

async function cancelMyPlan() {
  if (!confirm('Cancelar o seu plano? Você volta para o plano grátis e mantém o que já registrou.')) return;
  const { error } = await sb.rpc('cancel_plan');
  if (error) { alert('Não foi possível cancelar: ' + error.message); return; }
  await refreshCurrentUser();
  alert('Plano cancelado. Você voltou para o plano grátis.');
  loadMyPlanPage();
}

// Marca o plano atual na página Planos
function markCurrentPlan() {
  const mine = planOf(currentUser);
  document.querySelectorAll('#page-plans [data-plan]').forEach(btn => {
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    const current = btn.dataset.plan === mine;
    btn.textContent = current ? '✔ Seu plano atual' : btn.dataset.label;
    btn.disabled = current;
  });
}

async function loadMyPlanPage() {
  const box = document.getElementById('myPlanContent');
  const role = currentUser.user_type;
  const plan = planOf(currentUser);
  const options = PLAN_FOR_ROLE[role] || [];
  let html = `<div class="plan-summary"><span class="plan-summary-label">Plano atual</span>
    <h3>${escapeHtml(PLAN_LABELS[plan])}</h3>`;
  if (plan !== 'free' && currentUser.plan_expires_at) {
    html += `<p>Ativo até <strong>${new Date(currentUser.plan_expires_at).toLocaleDateString('pt-BR')}</strong>.</p>`;
  }
  if (plan !== 'free') {
    html += '<ul class="plan-features">' + (PLAN_FEATURES[plan] || []).map(f => `<li>${escapeHtml(f)}</li>`).join('') + '</ul>';
    if (plan !== 'institucional') html += '<button class="btn-secondary" onclick="cancelMyPlan()">Cancelar plano</button>';
  } else if (options.length) {
    html += '<p>Veja o que você ganha assinando:</p>' + options.map(p => `
      <div class="plan-summary-option"><b>${escapeHtml(PLAN_LABELS[p])}</b> — ${formatPrice(PLAN_PRICES[p])}/ano
        <ul class="plan-features">${PLAN_FEATURES[p].map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
      </div>`).join('') + '<button class="btn-primary" onclick="showPage(\'plans\')">Ver planos e assinar</button>';
  } else if (role === 'prefeitura') {
    html += `<p>O plano institucional é liberado pelo Administrador depois de uma proposta. Ele inclui: ${PLAN_FEATURES.institucional.join(', ').toLowerCase()}.</p>
      <a class="btn-primary" style="text-decoration:none;" href="mailto:contato@petmatch.com?subject=Proposta%20-%20Prefeitura">Solicitar proposta</a>`;
  }
  html += '</div>';

  const { data: subs } = await sb.from('subscriptions').select('*').eq('user_id', currentUser.id).order('starts_at', { ascending: false });
  if (subs && subs.length) {
    html += '<h3 style="margin-top:1.5rem;">Histórico de assinaturas</h3>' + subs.map(s => `
      <div class="commerce-row"><div><b>${escapeHtml(PLAN_LABELS[s.plan] || s.plan)}</b><br>
      <small>${new Date(s.starts_at).toLocaleDateString('pt-BR')} até ${new Date(s.ends_at).toLocaleDateString('pt-BR')} • ${formatPrice(s.price)}${s.cancelled_at ? ' • cancelada' : ''}</small></div></div>`).join('');
  }
  box.innerHTML = html;
}


// ===== PARCEIROS, ANÚNCIOS E LOJINHA =====
const PARTNER_CATEGORIES = {
  petshop: '🐾 Pet shop', clinica: '🩺 Clínica veterinária', racao: '🥣 Ração',
  banho_tosa: '🛁 Banho e tosa', hotel: '🏨 Hotelzinho', outro: '⭐ Outro'
};
const PRODUCT_CATEGORIES = {
  caminha: '🛏️ Caminha', roupa: '👕 Roupa', coleira: '🦮 Coleira', brinquedo: '🎾 Brinquedo', outro: '🎁 Outro'
};

const PLUS_SHOP_DISCOUNT = 10;
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
  if (hasPlan(currentUser, 'plus')) {
    document.querySelectorAll('.ads-strip').forEach(el => { el.innerHTML = ''; el.style.display = 'none'; });
    return;
  }
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
      ${p.plus_discount ? `<p class="partner-plus">🎁 ${hasPlan(currentUser, 'plus') ? 'Você tem' : 'Adotador Plus tem'} ${p.plus_discount}% de desconto</p>` : ''}
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

function setShopCategory(cat) {
  shopCategory = cat;
  document.querySelectorAll('#shopCats button').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
  renderShop();
}

function renderShop() {
  const grid = document.getElementById('shopGrid');
  const list = productsCache.filter(p => !shopCategory || p.category === shopCategory);
  if (!list.length) {
    grid.innerHTML = '<p style="text-align:center; color:#999; grid-column:1/-1;">Nenhum produto nessa categoria.</p>';
    return;
  }
  const names = window.__partnerNames || {};
  grid.innerHTML = list.map(p => {
    const img = safeImage(p.image_url);
    return `<div class="partner-card product-card">
      ${img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(p.name)}" class="product-img">` : `<div class="product-img product-noimg">${(PRODUCT_CATEGORIES[p.category] || '🎁').split(' ')[0]}</div>`}
      <span class="partner-cat">${PRODUCT_CATEGORIES[p.category] || PRODUCT_CATEGORIES.outro}</span>
      <h3>${escapeHtml(p.name)}</h3>
      ${p.description ? `<p class="partner-desc">${escapeHtml(p.description)}</p>` : ''}
      ${p.partner_id && names[p.partner_id] ? `<p>🏪 ${escapeHtml(names[p.partner_id])}</p>` : ''}
      ${hasPlan(currentUser, 'plus')
        ? `<div class="product-price"><s class="product-old">${formatPrice(p.price)}</s> ${formatPrice(p.price * (1 - PLUS_SHOP_DISCOUNT / 100))}<small class="partner-plus"> Plus -${PLUS_SHOP_DISCOUNT}%</small></div>`
        : `<div class="product-price">${formatPrice(p.price)}</div><small class="partner-desc">Com Adotador Plus: ${formatPrice(p.price * (1 - PLUS_SHOP_DISCOUNT / 100))}</small>`}
      <button type="button" class="btn-primary" onclick="productInterest('${escapeHtml(p.name).replace(/'/g, '&#39;')}')">Tenho interesse</button>
    </div>`;
  }).join('');
}

function productInterest(name) {
  alert('Você demonstrou interesse em "' + name + '". A compra ainda não está ativa: esta é uma vitrine do projeto (TCC).');
}

// ----- Gestão (Administrador e Supervisor) -----
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
// ADOTADOR: compatibilidade (básica grátis, avançada no Plus)
// ============================================================================
const SIZE_LABELS = { small: 'Pequeno', medium: 'Médio', large: 'Grande' };
const TYPE_LABELS = { dog: 'Cão', cat: 'Gato', rabbit: 'Coelho', bird: 'Pássaro' };

function matchPrefs() {
  return (currentUser && currentUser.user_type === 'adopter' && currentUser.match_prefs) || {};
}

function hasMatchPrefs() {
  const p = matchPrefs();
  return !!(p.type || p.size || p.energy || p.home || p.hours || p.exp || p.kids);
}

// Calcula o quanto o pet combina com o que o adotador procura (estimativa)
function petCompat(pet) {
  if (!hasMatchPrefs()) return null;
  const p = matchPrefs();
  const advanced = hasPlan(currentUser, 'plus');
  const energy = pet.energy || 'Moderada';
  const parts = [];
  const add = (weight, ratio, okText, badText) => parts.push({ weight, ratio, okText, badText });

  if (p.type) add(advanced ? 25 : 40, p.type === pet.type ? 1 : 0, 'É da espécie que você procura.', 'Não é a espécie que você procura.');
  if (p.size) add(advanced ? 15 : 35, p.size === pet.size ? 1 : (Math.abs(['small', 'medium', 'large'].indexOf(p.size) - ['small', 'medium', 'large'].indexOf(pet.size)) === 1 ? 0.5 : 0), 'O porte é o que você procura.', 'O porte é diferente do que você procura.');
  if (p.energy) add(advanced ? 15 : 25, p.energy === energy ? 1 : (p.energy === 'Moderada' || energy === 'Moderada' ? 0.5 : 0), 'A energia combina com a sua.', 'A energia é diferente da que você procura.');

  if (advanced) {
    if (p.home) {
      const base = { apto: { small: 1, medium: 0.7, large: 0.2 }, casa: { small: 1, medium: 0.9, large: 0.6 }, quintal: { small: 1, medium: 1, large: 1 } }[p.home][pet.size] ?? 1;
      const ratio = (p.home === 'apto' && energy === 'Alta') ? base * 0.6 : base;
      add(15, ratio, 'O espaço da sua casa é adequado para o porte e a energia dele.', 'O espaço da sua casa pode ser pequeno para o porte ou a energia dele.');
    }
    if (p.hours) {
      let ratio = { pouco: { Alta: 0.2, Moderada: 0.6, Baixa: 1 }, medio: { Alta: 0.7, Moderada: 1, Baixa: 1 }, muito: { Alta: 1, Moderada: 1, Baixa: 1 } }[p.hours][energy] ?? 1;
      if (p.hours === 'pouco' && Number(pet.age) <= 1) ratio *= 0.5;
      add(15, ratio, 'O seu tempo livre é suficiente para a rotina dele.', 'Ele pede mais tempo de atenção do que você tem disponível.');
    }
    if (p.exp) {
      const hard = pet.size === 'large' || energy === 'Alta';
      const ratio = { primeira: hard ? 0.5 : 1, alguma: hard ? 0.85 : 1, experiente: 1 }[p.exp];
      add(10, ratio, 'Combina com a sua experiência.', 'Pode ser um desafio para quem está começando.');
    }
    if (p.kids === 'sim') {
      const ratio = (pet.size === 'large' && energy === 'Alta') ? 0.6 : 1;
      add(5, ratio, 'Bom para casas com crianças.', 'Um pet grande e agitado pede cuidado perto de crianças.');
    }
  }

  const max = parts.reduce((s, x) => s + x.weight, 0);
  if (!max) return null;
  const score = Math.round(parts.reduce((s, x) => s + x.weight * x.ratio, 0) / max * 100);
  const reasons = parts.map(x => ({ ok: x.ratio >= 0.7, text: x.ratio >= 0.7 ? x.okText : x.badText }));
  if (advanced && p.other === 'sim') reasons.push({ ok: null, text: 'Você tem outros animais: pergunte à ONG como ele convive com eles.' });
  return { score, reasons, advanced };
}

function compatDetailHtml(pet) {
  if (!currentUser || currentUser.user_type !== 'adopter') return '';
  const c = petCompat(pet);
  if (!c) return '<p style="text-align:center;"><a href="#" onclick="closePetDetailModal(); showPage(\'compat\'); return false;">💚 Diga o que você procura e veja a compatibilidade</a></p>';
  const list = c.advanced
    ? '<ul class="compat-reasons">' + c.reasons.map(r => `<li>${r.ok === null ? 'ℹ️' : (r.ok ? '✅' : '⚠️')} ${escapeHtml(r.text)}</li>`).join('') + '</ul>'
    : '<p style="font-size:0.85rem; color:#777;">Compatibilidade básica (espécie, porte e energia). Com o <a href="#" onclick="closePetDetailModal(); showPage(\'plans\'); return false;">Adotador Plus</a> a análise inclui casa, rotina, experiência e crianças.</p>';
  return `<div class="compat-box"><h3 style="margin-top:0;">💚 ${c.score}% compatível</h3>${list}</div>`;
}

function loadCompatForm() {
  const p = matchPrefs();
  const plus = hasPlan(currentUser, 'plus');
  document.getElementById('cpType').value = p.type || '';
  document.getElementById('cpSize').value = p.size || '';
  document.getElementById('cpEnergy').value = p.energy || '';
  ['Home:home', 'Hours:hours', 'Exp:exp', 'Kids:kids', 'Other:other'].forEach(pair => {
    const [id, key] = pair.split(':');
    const el = document.getElementById('cp' + id);
    el.value = p[key] || '';
    el.disabled = !plus;
  });
  document.getElementById('compatLock').innerHTML = plus ? '' :
    '<p class="compat-lock">🔒 A análise avançada (casa, rotina, experiência e crianças) é do <a href="#" onclick="showPage(\'plans\'); return false;">Adotador Plus</a>.</p>';
}

async function saveCompat(e) {
  e.preventDefault();
  const plus = hasPlan(currentUser, 'plus');
  const prefs = {
    type: document.getElementById('cpType').value,
    size: document.getElementById('cpSize').value,
    energy: document.getElementById('cpEnergy').value
  };
  if (plus) {
    prefs.home = document.getElementById('cpHome').value;
    prefs.hours = document.getElementById('cpHours').value;
    prefs.exp = document.getElementById('cpExp').value;
    prefs.kids = document.getElementById('cpKids').value;
    prefs.other = document.getElementById('cpOther').value;
  } else {
    const old = matchPrefs();
    ['home', 'hours', 'exp', 'kids', 'other'].forEach(k => { if (old[k]) prefs[k] = old[k]; });
  }
  Object.keys(prefs).forEach(k => { if (!prefs[k]) delete prefs[k]; });
  const { error } = await sb.from('profiles').update({ match_prefs: prefs }).eq('id', currentUser.id);
  if (error) { alert('Erro ao salvar: ' + error.message); return; }
  currentUser = { ...currentUser, match_prefs: prefs };
  alert('Preferências salvas! Os pets agora mostram a compatibilidade.');
  showPage('pets');
}

// Pets novos (últimas 24 horas): primeiro para o Adotador Plus
function isNewPet(pet) {
  return pet.created_at && (Date.now() - new Date(pet.created_at).getTime()) < 24 * 3600 * 1000;
}
function canSeeNewPets() {
  return !!currentUser && (currentUser.user_type !== 'adopter' || hasPlan(currentUser, 'plus'));
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => alert('Copiado!'), () => prompt('Copie:', text));
  } else {
    prompt('Copie:', text);
  }
}

// ============================================================================
// ADOTADOR: Meus Pets (carteirinha, saúde, lembretes, diário, pós-adoção)
// ============================================================================
let myAdopted = [];

async function loadAdoptedRequests() {
  const { data } = await sb
    .from('adoption_requests')
    .select('id, created_at, pet_id, pets(name, type, breed, age, size, image_url, ong_id)')
    .eq('adopter_id', currentUser.id)
    .eq('status', 'completed')
    .order('created_at', { ascending: false });
  return data || [];
}

function daysSince(date) {
  return Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86400000));
}

function dueInfo(rec) {
  if (!rec.next_due) return null;
  const d = new Date(rec.next_due + 'T12:00:00');
  const diff = Math.ceil((d.getTime() - Date.now()) / 86400000);
  if (diff > 7) return null;
  return { overdue: diff < 0, days: diff, date: d.toLocaleDateString('pt-BR') };
}

async function loadMyPetsPage() {
  const plus = hasPlan(currentUser, 'plus');
  const content = document.getElementById('myPetsContent');
  content.innerHTML = '<p style="color:#999; grid-column:1/-1;">Carregando...</p>';
  document.getElementById('myPetsLock').innerHTML = plus ? '' : `
    <div class="compat-lock">🔒 Para registrar saúde, diário e lembretes você precisa do <a href="#" onclick="showPage('plans'); return false;">Adotador Plus</a>.
    A carteirinha e o que você já registrou continuam disponíveis.</div>`;

  myAdopted = await loadAdoptedRequests();
  if (!myAdopted.length) {
    content.innerHTML = '<p style="color:#999; grid-column:1/-1; text-align:center;">Quando uma ONG concluir a sua adoção, o seu pet aparece aqui.</p>';
    document.getElementById('myPetsReminders').innerHTML = '';
    return;
  }

  const ids = myAdopted.map(r => r.id);
  const [{ data: recs }, { data: diary }] = await Promise.all([
    sb.from('pet_care_records').select('*').in('request_id', ids),
    sb.from('pet_diary').select('id, request_id, note, created_at').in('request_id', ids).order('created_at', { ascending: false })
  ]);

  // Lembretes: vencem em até 7 dias ou já venceram
  const due = [];
  (recs || []).forEach(rec => {
    const info = dueInfo(rec);
    if (info) due.push({ rec, info, petName: (myAdopted.find(r => r.id === rec.request_id)?.pets || {}).name });
  });
  document.getElementById('myPetsReminders').innerHTML = due.length ? `
    <div class="reminders-box"><h3>🔔 Lembretes</h3>${due.map(d => `
      <div class="commerce-row"><div><b>${escapeHtml(d.rec.title)}</b> de ${escapeHtml(d.petName || 'pet')}<br>
      <small>${d.info.overdue ? '⚠️ Atrasado desde ' : 'Vence em '}${d.info.date}</small></div>
      ${plus ? `<button class="btn-secondary" onclick="markReminderDone('${d.rec.id}')">Feito</button>` : ''}</div>`).join('')}</div>` : '';

  content.innerHTML = myAdopted.map(r => {
    const pet = r.pets || {};
    const days = daysSince(r.created_at);
    const entries = (diary || []).filter(d => d.request_id === r.id);
    const pct = Math.min(100, Math.round(days / 30 * 100));
    return `
    <div class="partner-card product-card">
      <img src="${escapeHtml(pet.image_url || 'images/pet-dog-brown-1.png')}" alt="${escapeHtml(pet.name || '')}" class="product-img">
      <h3>${escapeHtml(pet.name || 'Pet')}</h3>
      <p>Adotado em ${new Date(r.created_at).toLocaleDateString('pt-BR')} • dia ${days + 1} em casa</p>
      <div class="adapt-bar" title="Primeiros 30 dias de adaptação"><div style="width:${pct}%"></div></div>
      <small class="partner-desc">${days < 30 ? 'Primeiros 30 dias de adaptação' : 'Adaptação concluída'} • ${entries.length} registro(s) no diário${entries[0] ? '<br>Último: ' + escapeHtml(entries[0].note.slice(0, 60)) : ''}</small>
      <div class="pet-tool-buttons">
        <button class="btn-secondary" onclick="openPetCard('${r.id}')">🪪 Carteirinha</button>
        <button class="btn-secondary" onclick="openPetHealth('${r.id}')">💉 Saúde</button>
        <button class="btn-secondary" onclick="openPetDiary('${r.id}')">📔 Diário</button>
      </div>
    </div>`;
  }).join('');
}

function closePetToolModal() {
  document.getElementById('petToolModal').classList.remove('active');
}

function openPetToolModal(html) {
  document.getElementById('petToolContent').innerHTML = html;
  document.getElementById('petToolModal').classList.add('active');
}

async function openPetCard(requestId) {
  const r = myAdopted.find(x => x.id === requestId);
  if (!r) return;
  const pet = r.pets || {};
  const [{ data: recs }, { data: ong }] = await Promise.all([
    sb.from('pet_care_records').select('*').eq('request_id', requestId).order('record_date', { ascending: true }),
    sb.from('profiles').select('name').eq('id', pet.ong_id).single()
  ]);
  const vacc = (recs || []).filter(x => x.kind === 'vacina');
  const fmt = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
  openPetToolModal(`
    <div class="carteirinha">
      <div class="carteirinha-head"><span>🐾 PetMatch</span><b>CARTEIRINHA DIGITAL</b></div>
      <div class="carteirinha-body">
        <img src="${escapeHtml(pet.image_url || 'images/pet-dog-brown-1.png')}" alt="">
        <div>
          <h2>${escapeHtml(pet.name || '')}</h2>
          <p><b>Espécie:</b> ${escapeHtml(TYPE_LABELS[pet.type] || '—')}</p>
          <p><b>Raça:</b> ${escapeHtml(pet.breed || '—')}</p>
          <p><b>Idade na adoção:</b> ${escapeHtml(pet.age)} ano(s)</p>
          <p><b>Porte:</b> ${escapeHtml(SIZE_LABELS[pet.size] || '—')}</p>
          <p><b>Tutor:</b> ${escapeHtml(currentUser.name)}</p>
          <p><b>Adotado em:</b> ${new Date(r.created_at).toLocaleDateString('pt-BR')} (ONG ${escapeHtml(ong ? ong.name : '—')})</p>
        </div>
      </div>
      <h4>Vacinas</h4>
      ${vacc.length ? `<table class="log-table"><tr><th>Vacina</th><th>Data</th><th>Próxima</th></tr>${vacc.map(v => `<tr><td>${escapeHtml(v.title)}</td><td>${fmt(v.record_date)}</td><td>${fmt(v.next_due)}</td></tr>`).join('')}</table>` : '<p style="color:#888;">Nenhuma vacina registrada ainda.</p>'}
      <p class="carteirinha-foot">Registro nº ${escapeHtml(requestId.slice(0, 8).toUpperCase())} • emitido em ${new Date().toLocaleDateString('pt-BR')}</p>
    </div>
    <button class="btn-primary" style="width:100%; margin-top:1rem;" onclick="printPetCard()">Imprimir ou salvar em PDF</button>`);
}

function printPetCard() {
  document.body.classList.add('printing-card');
  window.print();
  setTimeout(() => document.body.classList.remove('printing-card'), 500);
}

const CARE_KINDS = { consulta: 'Consulta', vacina: 'Vacina', vermifugo: 'Vermífugo', outro: 'Outro cuidado' };

async function openPetHealth(requestId) {
  const r = myAdopted.find(x => x.id === requestId);
  if (!r) return;
  const plus = hasPlan(currentUser, 'plus');
  const { data: recs } = await sb.from('pet_care_records').select('*').eq('request_id', requestId).order('record_date', { ascending: false });
  const fmt = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '';
  openPetToolModal(`
    <h2>💉 Saúde de ${escapeHtml((r.pets || {}).name || 'pet')}</h2>
    ${plus ? `
    <form onsubmit="saveCareRecord(event, '${requestId}')" class="commerce-form">
      <select id="crKind">${Object.entries(CARE_KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <input type="text" id="crTitle" placeholder="O que foi feito (ex.: V10, consulta de rotina)" maxlength="120" required>
      <label class="commerce-check">Data <input type="date" id="crDate" value="${new Date().toISOString().slice(0, 10)}" required></label>
      <label class="commerce-check">Próxima (lembrete) <input type="date" id="crNext"></label>
      <input type="text" id="crNotes" placeholder="Observações (opcional)" maxlength="1000">
      <button class="btn-primary" type="submit">Adicionar</button>
    </form>` : '<p class="compat-lock">🔒 Registrar novos cuidados é do Adotador Plus.</p>'}
    ${(recs || []).length ? (recs || []).map(x => `
      <div class="commerce-row"><div><b>${CARE_KINDS[x.kind] || x.kind}: ${escapeHtml(x.title)}</b><br>
        <small>${fmt(x.record_date)}${x.next_due ? ' • próxima: ' + fmt(x.next_due) : ''}${x.notes ? ' • ' + escapeHtml(x.notes) : ''}</small></div>
        <button class="btn-secondary" style="color:#c0392b;" onclick="deleteCareRecord('${x.id}', '${requestId}')">Apagar</button></div>`).join('')
      : '<p style="color:#888;">Nenhum registro de saúde ainda.</p>'}`);
}

async function saveCareRecord(e, requestId) {
  e.preventDefault();
  const row = {
    request_id: requestId, adopter_id: currentUser.id,
    kind: document.getElementById('crKind').value,
    title: document.getElementById('crTitle').value.trim(),
    record_date: document.getElementById('crDate').value,
    next_due: document.getElementById('crNext').value || null,
    notes: document.getElementById('crNotes').value.trim() || null
  };
  const { error } = await sb.from('pet_care_records').insert([row]);
  if (error) { alert('Não foi possível salvar: ' + error.message); return; }
  syncCareReminders();
  openPetHealth(requestId);
}

async function deleteCareRecord(id, requestId) {
  if (!confirm('Apagar este registro?')) return;
  const { error } = await sb.from('pet_care_records').delete().eq('id', id);
  if (error) { alert('Erro: ' + error.message); return; }
  openPetHealth(requestId);
}

async function markReminderDone(id) {
  const { error } = await sb.from('pet_care_records').update({ next_due: null }).eq('id', id);
  if (error) { alert('Erro: ' + error.message); return; }
  loadMyPetsPage();
}

const DIARY_KINDS = { note: '📝 Anotação', behavior: '🐕 Comportamento', routine: '🕒 Rotina' };

async function openPetDiary(requestId) {
  const r = myAdopted.find(x => x.id === requestId);
  if (!r) return;
  const plus = hasPlan(currentUser, 'plus');
  const { data: entries } = await sb.from('pet_diary').select('*').eq('request_id', requestId).order('created_at', { ascending: false });
  openPetToolModal(`
    <h2>📔 Diário de ${escapeHtml((r.pets || {}).name || 'pet')}</h2>
    <p style="color:#777; font-size:0.9rem;">Registre a adaptação: comportamento, rotina e momentos especiais, com fotos.</p>
    ${plus ? `
    <form onsubmit="saveDiaryEntry(event, '${requestId}')" class="commerce-form">
      <select id="dyKind">${Object.entries(DIARY_KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <textarea id="dyNote" placeholder="O que aconteceu hoje?" maxlength="1500" rows="3" required style="grid-column:1/-1; padding:0.6rem; border:1px solid var(--border-color); border-radius:10px; font-family:inherit;"></textarea>
      <input type="file" id="dyPhoto" accept="image/*">
      <button class="btn-primary" type="submit">Registrar</button>
    </form>` : '<p class="compat-lock">🔒 Novos registros no diário são do Adotador Plus.</p>'}
    ${(entries || []).length ? (entries || []).map(x => `
      <div class="diary-entry">
        <small>${DIARY_KINDS[x.kind] || ''} • ${fmtDateTime(x.created_at)}</small>
        <p>${escapeHtml(x.note)}</p>
        ${safeImage(x.photo_url) ? `<img src="${escapeHtml(safeImage(x.photo_url))}" alt="Foto do diário">` : ''}
        <button class="btn-secondary" style="color:#c0392b; padding:2px 10px;" onclick="deleteDiaryEntry('${x.id}', '${requestId}')">Apagar</button>
      </div>`).join('') : '<p style="color:#888;">O diário ainda está vazio.</p>'}`);
}

async function saveDiaryEntry(e, requestId) {
  e.preventDefault();
  const row = { request_id: requestId, adopter_id: currentUser.id, kind: document.getElementById('dyKind').value, note: document.getElementById('dyNote').value.trim() };
  const file = document.getElementById('dyPhoto').files[0];
  try {
    if (file) row.photo_url = await uploadFileToBucket('user-uploads', file, `diary/${currentUser.id}`);
  } catch (err) {
    alert('Erro ao enviar a foto: ' + err.message);
    return;
  }
  const { error } = await sb.from('pet_diary').insert([row]);
  if (error) { alert('Não foi possível salvar: ' + error.message); return; }
  openPetDiary(requestId);
}

async function deleteDiaryEntry(id, requestId) {
  if (!confirm('Apagar este registro do diário?')) return;
  const { error } = await sb.from('pet_diary').delete().eq('id', id);
  if (error) { alert('Erro: ' + error.message); return; }
  openPetDiary(requestId);
}

// Lembretes viram notificações (uma vez por lembrete)
async function syncCareReminders() {
  if (!currentUser || currentUser.user_type !== 'adopter' || !hasPlan(currentUser, 'plus')) return;
  const adopted = await loadAdoptedRequests();
  if (!adopted.length) return;
  const { data: recs } = await sb.from('pet_care_records').select('*').in('request_id', adopted.map(r => r.id));
  const { data: existing } = await sb.from('notifications').select('message').eq('adopter_id', currentUser.id);
  const have = new Set((existing || []).map(n => n.message));
  for (const rec of (recs || [])) {
    const info = dueInfo(rec);
    if (!info) continue;
    const petName = (adopted.find(r => r.id === rec.request_id)?.pets || {}).name || 'seu pet';
    const message = `Lembrete: ${rec.title} de ${petName} ${info.overdue ? 'está atrasado (era para ' + info.date + ')' : 'vence em ' + info.date}.`;
    if (have.has(message)) continue;
    await sb.from('notifications').insert([{ adopter_id: currentUser.id, request_id: rec.request_id, message }]);
    have.add(message);
  }
  refreshNotificationBadge();
}

async function afterAuthExtras() {
  syncCareReminders();
}


// ============================================================================
// ONG: plano, uso, chat, acompanhamento, divulgação, eventos, relatórios, equipe
// ============================================================================
const ONG_PET_LIMITS = { free: 10, essencial: 30, premium: 100 };

async function renderOngBanner() {
  const el = document.getElementById('ongPlanBanner');
  if (!el) return;
  const plan = ongPlan();
  const { count } = await sb.from('pets').select('*', { count: 'exact', head: true }).eq('ong_id', ongScopeId());
  const limit = ONG_PET_LIMITS[plan] || 10;
  const pct = Math.min(100, Math.round((count || 0) / limit * 100));
  el.innerHTML = `
    <div class="ong-banner">
      <div><b>Plano: ${escapeHtml(PLAN_LABELS[plan] || plan)}</b>${isOngMember() ? ` • você é administrador da ONG ${escapeHtml(ongScope.profile.name)}` : ''}<br>
      <small>Pets cadastrados: ${count || 0} de ${limit}</small>
      <div class="adapt-bar"><div style="width:${pct}%"></div></div></div>
      ${plan !== 'premium' && !isOngMember() ? `<button class="btn-secondary" onclick="showPage('plans'); setPlanAudience('ong')">Ver planos</button>` : ''}
    </div>`;
}

function lockHtml(text) {
  return `<div class="compat-lock">🔒 ${text} <a href="#" onclick="showPage('plans'); setPlanAudience('ong'); return false;">Ver planos</a></div>`;
}

// ----- Chat entre ONG e adotador -----
async function openRequestChat(requestId, petName, role) {
  const { data: msgs } = await sb.from('request_messages').select('*').eq('request_id', requestId).order('created_at', { ascending: true });
  const list = msgs || [];
  const otherWrote = list.some(m => m.sender_id !== currentUser.id);
  const canSend = role === 'ong' ? ['essencial', 'premium'].includes(ongPlan()) : otherWrote;
  openPetToolModal(`
    <h2>💬 Conversa sobre ${escapeHtml(petName)}</h2>
    <div class="chat-box">${list.length ? list.map(m => `
      <div class="chat-msg ${m.sender_id === currentUser.id ? 'mine' : ''}"><small>${m.sender_id === currentUser.id ? 'Você' : (role === 'ong' ? 'Adotador' : 'ONG')} • ${fmtDateTime(m.created_at)}</small><p>${escapeHtml(m.body)}</p></div>`).join('')
      : '<p style="color:#888;">Nenhuma mensagem ainda.</p>'}</div>
    ${canSend ? `<form onsubmit="sendRequestMessage(event, '${requestId}', ${jsStr(petName)}, '${role}')" class="chat-form">
      <input type="text" id="chatInput" maxlength="1000" placeholder="Escreva sua mensagem" required><button class="btn-primary" type="submit">Enviar</button></form>`
      : role === 'ong' ? lockHtml('Conversar com adotantes é do plano ONG Essencial ou Premium.') : '<p style="color:#888;">Você poderá responder depois que a ONG enviar uma mensagem.</p>'}`);
}

async function sendRequestMessage(e, requestId, petName, role) {
  e.preventDefault();
  const body = document.getElementById('chatInput').value.trim();
  if (!body) return;
  const { error } = await sb.from('request_messages').insert([{ request_id: requestId, sender_id: currentUser.id, body }]);
  if (error) { alert('Não foi possível enviar: ' + error.message); return; }
  if (role === 'ong') await createNotification(requestId, `Nova mensagem da ONG sobre ${petName}. Veja em Minhas Solicitações > Mensagens.`);
  openRequestChat(requestId, petName, role);
}

// ----- Acompanhamento (Premium) -----
async function openRequestNotes(requestId, petName) {
  if (ongPlan() !== 'premium') { openPetToolModal(lockHtml('O histórico de acompanhamento é do plano ONG Premium.')); return; }
  const { data: notes } = await sb.from('request_notes').select('*').eq('request_id', requestId).order('created_at', { ascending: false });
  openPetToolModal(`
    <h2>📋 Acompanhamento de ${escapeHtml(petName)}</h2>
    <p style="color:#777; font-size:0.9rem;">Anotações internas: só a equipe da ONG vê.</p>
    <form onsubmit="saveRequestNote(event, '${requestId}', ${jsStr(petName)})" class="chat-form">
      <input type="text" id="noteInput" maxlength="1000" placeholder="Ex.: ligou para o adotante, casa visitada" required><button class="btn-primary" type="submit">Salvar</button></form>
    ${(notes || []).length ? (notes || []).map(n => `<div class="diary-entry"><small>${fmtDateTime(n.created_at)}</small><p>${escapeHtml(n.note)}</p></div>`).join('') : '<p style="color:#888;">Nenhuma anotação ainda.</p>'}`);
}

async function saveRequestNote(e, requestId, petName) {
  e.preventDefault();
  const note = document.getElementById('noteInput').value.trim();
  const { error } = await sb.from('request_notes').insert([{ request_id: requestId, author_id: currentUser.id, note }]);
  if (error) { alert('Erro: ' + error.message); return; }
  openRequestNotes(requestId, petName);
}

async function setVisitStatus(id, status) {
  const { error } = await sb.from('visits').update({ status }).eq('id', id);
  if (error) { alert('Erro: ' + error.message); return; }
  renderAdminVisits();
}

// ----- Divulgação: link próprio, cartão, Pix, modelos -----
function ongPublicLink() {
  return location.origin + location.pathname + '?ong=' + ongScopeId();
}

async function renderPromoTab() {
  const el = document.getElementById('promoContent');
  const plan = ongPlan();
  const profile = ongScope ? ongScope.profile : currentUser;
  const basic = ['essencial', 'premium'].includes(plan);
  el.innerHTML = `
    <div class="promo-box"><h3>Página própria da ONG</h3>
    ${basic ? `<p>Compartilhe este link nas redes sociais: ele mostra a sua ONG e os pets disponíveis.</p>
      <p><input type="text" readonly value="${escapeHtml(ongPublicLink())}" style="width:100%; padding:0.5rem;" onclick="this.select()"></p>
      <button class="btn-secondary" onclick="copyText(${jsStr(ongPublicLink())})">Copiar link</button>
      <button class="btn-secondary" onclick="showOngPublic('${ongScopeId()}')">Ver como fica</button>`
      : lockHtml('A página própria da ONG é do plano Essencial ou Premium.')}</div>
    <div class="promo-box"><h3>Cartão de divulgação</h3>
    ${basic ? `<p>Uma imagem pronta para postar no Instagram ou WhatsApp.</p>
      <select id="cardPetSelect"></select> <button class="btn-primary" onclick="makeShareCard()">Gerar imagem</button>
      <div id="shareCardOut"></div>` : lockHtml('O cartão de divulgação é do plano Essencial ou Premium.')}</div>
    <div class="promo-box"><h3>Pix para doações</h3>
    ${plan === 'premium' && !isOngMember() ? `<p>Aparece na sua página pública e nos detalhes dos pets.</p>
      <form onsubmit="savePix(event)" class="commerce-form">
        <input type="text" id="pixKey" placeholder="Chave Pix" maxlength="140" value="${escapeHtml(profile.pix_key || '')}">
        <input type="text" id="pixName" placeholder="Nome do recebedor" maxlength="80" value="${escapeHtml(profile.pix_name || '')}">
        <button class="btn-primary" type="submit">Salvar</button></form>`
      : plan === 'premium' ? '<p>Somente a conta principal da ONG altera o Pix.</p>' : lockHtml('Divulgar sua chave Pix é do plano ONG Premium.')}</div>
    <div class="promo-box"><h3>Modelos de documentos</h3>
    ${plan === 'premium' ? `<p>Baixe, edite no Word e use com os adotantes.</p>
      <button class="btn-secondary" onclick="downloadTemplate('termo')">Termo de adoção</button>
      <button class="btn-secondary" onclick="downloadTemplate('questionario')">Questionário de entrevista</button>`
      : lockHtml('Modelos de termo e questionário são do plano ONG Premium.')}</div>`;
  if (basic) {
    const { data: pets } = await sb.from('pets').select('id, name').eq('ong_id', ongScopeId()).eq('status', 'available');
    const sel = document.getElementById('cardPetSelect');
    if (sel) sel.innerHTML = (pets || []).map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('') || '<option value="">Sem pets disponíveis</option>';
  }
}

async function savePix(e) {
  e.preventDefault();
  const pix_key = document.getElementById('pixKey').value.trim() || null;
  const pix_name = document.getElementById('pixName').value.trim() || null;
  const { error } = await sb.from('profiles').update({ pix_key, pix_name }).eq('id', currentUser.id);
  if (error) { alert('Erro: ' + error.message); return; }
  currentUser = { ...currentUser, pix_key, pix_name };
  await loadOngScope();
  alert('Pix salvo!');
}

function downloadTemplate(kind) {
  const ong = escapeHtml((ongScope ? ongScope.profile : currentUser).name);
  const docs = {
    termo: ['Termo de adoção responsável', `<h1>Termo de Adoção Responsável</h1><p><b>ONG:</b> ${ong}</p><p><b>Adotante:</b> ________________________ <b>Documento:</b> ____________</p><p><b>Animal:</b> ________________________ <b>Espécie/Raça:</b> ____________</p><p>O adotante declara que:</p><ol><li>Oferecerá alimentação, água, abrigo e cuidados veterinários.</li><li>Não abandonará, venderá, doará ou maltratará o animal.</li><li>Manterá vacinas e vermifugação em dia e castrará o animal quando indicado.</li><li>Permitirá visitas de acompanhamento da ONG.</li><li>Devolverá o animal à ONG caso não possa mais cuidar dele.</li></ol><p>Data: ___/___/______</p><p>Assinatura do adotante: ______________________</p><p>Assinatura da ONG: ______________________</p>`],
    questionario: ['Questionário de entrevista', `<h1>Questionário de Entrevista de Adoção</h1><p><b>ONG:</b> ${ong}</p><ol><li>Por que você quer adotar?</li><li>Já teve animais? O que aconteceu com eles?</li><li>Onde você mora (casa, apartamento, quintal, telas de proteção)?</li><li>Quantas pessoas moram com você? Todos concordam com a adoção?</li><li>Há crianças ou outros animais em casa?</li><li>Quantas horas o animal ficaria sozinho por dia?</li><li>Quem cuidará dele em viagens?</li><li>Você tem condições de arcar com ração, vacinas e consultas?</li></ol>`]
  };
  const [name, body] = docs[kind];
  const blob = new Blob(['<html><head><meta charset="utf-8"></head><body style="font-family:Arial">' + body + '</body></html>'], { type: 'application/msword' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name + '.doc';
  document.body.appendChild(a); a.click(); a.remove();
}

async function makeShareCard() {
  const id = document.getElementById('cardPetSelect').value;
  if (!id) { alert('Cadastre um pet disponível primeiro.'); return; }
  const { data: pet } = await sb.from('pets').select('*').eq('id', id).single();
  const ongName = (ongScope ? ongScope.profile : currentUser).name;
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1080;
  const g = c.getContext('2d');
  g.fillStyle = '#2f80ed'; g.fillRect(0, 0, 1080, 1080);
  g.fillStyle = '#fff'; g.fillRect(40, 40, 1000, 1000);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  const done = () => {
    g.fillStyle = '#2f80ed'; g.font = 'bold 72px sans-serif'; g.textAlign = 'center';
    g.fillText('Adote ' + pet.name + '!', 540, 760);
    g.fillStyle = '#444'; g.font = '40px sans-serif';
    g.fillText(`${TYPE_LABELS[pet.type] || ''} • ${SIZE_LABELS[pet.size] || ''} • ${pet.age} ano(s)`, 540, 830);
    g.fillText(pet.city + ' • ' + ongName, 540, 890);
    g.fillStyle = '#27ae60'; g.font = 'bold 44px sans-serif';
    g.fillText('Adoção pelo PetMatch 🐾', 540, 970);
    const url = c.toDataURL('image/png');
    document.getElementById('shareCardOut').innerHTML = `<img src="${url}" style="max-width:100%; margin-top:1rem; border-radius:12px;"><br><a class="btn-primary" download="${escapeHtml(pet.name)}-petmatch.png" href="${url}">Baixar imagem</a>`;
  };
  img.onload = () => { g.drawImage(img, 80, 80, 920, 560); done(); };
  img.onerror = () => { g.fillStyle = '#eef3fb'; g.fillRect(80, 80, 920, 560); g.fillStyle = '#2f80ed'; g.font = '200px sans-serif'; g.fillText('🐾', 540, 420); done(); };
  img.src = safeImage(pet.image_url) || 'images/pet-dog-brown-1.png';
}

// Página pública da ONG (?ong=<id>)
async function showOngPublic(ongId) {
  showPage('ong-public');
  const el = document.getElementById('ongPublicContent');
  el.innerHTML = '<p style="color:#999;">Carregando...</p>';
  const { data: ong } = await sb.from('profiles').select('id, name, city, address, phone, email, user_type, plan, plan_expires_at, pix_key, pix_name').eq('id', ongId).maybeSingle();
  if (!ong || ong.user_type !== 'ong') { el.innerHTML = '<p>ONG não encontrada.</p>'; return; }
  const [{ data: pets }, { data: evs }] = await Promise.all([
    sb.from('pets').select('*').eq('ong_id', ongId).eq('status', 'available'),
    sb.from('events').select('*').eq('ong_id', ongId).gte('event_date', new Date().toISOString()).order('event_date')
  ]);
  const plan = planOf(ong);
  el.innerHTML = `
    <h2>${escapeHtml(ong.name)} ${['essencial', 'premium'].includes(plan) ? '<span class="ong-verified">✔ ONG Verificada</span>' : ''}</h2>
    <p>${escapeHtml(ong.city || '')}${ong.address ? ' • ' + escapeHtml(ong.address) : ''}${ong.phone ? ' • ' + escapeHtml(ong.phone) : ''}</p>
    ${plan === 'premium' && ong.pix_key ? `<p>💚 Apoie a ONG via Pix: <code>${escapeHtml(ong.pix_key)}</code>${ong.pix_name ? ' (' + escapeHtml(ong.pix_name) + ')' : ''} <button class="btn-secondary" style="padding:2px 10px;" onclick="copyText(${jsStr(ong.pix_key)})">Copiar</button></p>` : ''}
    ${(evs || []).length ? `<h3>Próximos eventos</h3>${evs.map(e => eventCardHtml(e)).join('')}` : ''}
    <h3>Pets disponíveis (${(pets || []).length})</h3>
    <div class="partners-grid">${(pets || []).map(p => `
      <div class="partner-card product-card"><img src="${escapeHtml(safeImage(p.image_url) || 'images/pet-dog-brown-1.png')}" class="product-img" alt="">
      <h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(TYPE_LABELS[p.type] || '')} • ${escapeHtml(p.age)} ano(s) • ${escapeHtml(p.city)}</p>
      <button class="btn-primary" onclick="showPage('pets')">Ver na lista de pets</button></div>`).join('') || '<p style="color:#888;">Nenhum pet disponível agora.</p>'}</div>`;
}

// ----- Eventos (Premium cria; todos veem) -----
function eventCardHtml(e) {
  return `<div class="partner-card"><h3>📅 ${escapeHtml(e.title)}</h3>
    <p><b>${fmtDateTime(e.event_date)}</b>${e.city ? ' • ' + escapeHtml(e.city) : ''}</p>
    ${e.location ? `<p>📍 ${escapeHtml(e.location)} <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.location + ' ' + (e.city || ''))}" target="_blank" rel="noopener noreferrer">Ver no mapa</a></p>` : ''}
    ${e.description ? `<p class="partner-desc">${escapeHtml(e.description)}</p>` : ''}</div>`;
}

async function loadEventsPage() {
  const el = document.getElementById('eventsPublicList');
  el.innerHTML = '<p style="color:#999; grid-column:1/-1;">Carregando...</p>';
  const { data } = await sb.from('events').select('*').gte('event_date', new Date().toISOString()).order('event_date');
  el.innerHTML = (data || []).map(eventCardHtml).join('') || '<p style="color:#999; grid-column:1/-1; text-align:center;">Nenhum evento marcado por enquanto.</p>';
}

async function renderOngEventsTab() {
  const el = document.getElementById('ongEventsContent');
  const premium = ongPlan() === 'premium';
  const { data } = await sb.from('events').select('*').eq('ong_id', ongScopeId()).order('event_date', { ascending: false });
  el.innerHTML = (premium ? `
    <form onsubmit="saveEvent(event)" class="commerce-form">
      <input type="text" id="evTitle" placeholder="Título (ex.: Feira de adoção)" maxlength="120" required>
      <label class="commerce-check">Data e hora <input type="datetime-local" id="evDate" required></label>
      <input type="text" id="evLocation" placeholder="Local" maxlength="160">
      <input type="text" id="evCity" placeholder="Cidade" maxlength="80">
      <input type="text" id="evDesc" placeholder="Descrição" maxlength="1000">
      <button class="btn-primary" type="submit">Criar evento</button></form>` : lockHtml('Criar eventos é do plano ONG Premium.')) +
    ((data || []).map(e => `<div class="commerce-row"><div><b>${escapeHtml(e.title)}</b><br><small>${fmtDateTime(e.event_date)}${e.city ? ' • ' + escapeHtml(e.city) : ''}</small></div>
      <button class="btn-secondary" style="color:#c0392b;" onclick="deleteEvent('${e.id}')">Apagar</button></div>`).join('') || '<p style="color:#888;">Nenhum evento criado.</p>');
}

async function saveEvent(e) {
  e.preventDefault();
  const row = {
    ong_id: ongScopeId(),
    title: document.getElementById('evTitle').value.trim(),
    event_date: new Date(document.getElementById('evDate').value).toISOString(),
    location: document.getElementById('evLocation').value.trim() || null,
    city: document.getElementById('evCity').value.trim() || null,
    description: document.getElementById('evDesc').value.trim() || null
  };
  const { error } = await sb.from('events').insert([row]);
  if (error) { alert('Erro: ' + error.message); return; }
  renderOngEventsTab();
}

async function deleteEvent(id) {
  if (!confirm('Apagar este evento?')) return;
  const { error } = await sb.from('events').delete().eq('id', id);
  if (error) { alert('Erro: ' + error.message); return; }
  renderOngEventsTab();
}

// ----- Relatórios (básico no Essencial, completo no Premium) -----
async function renderReportsTab() {
  const el = document.getElementById('reportsContent');
  const plan = ongPlan();
  if (!['essencial', 'premium'].includes(plan)) { el.innerHTML = lockHtml('Estatísticas são dos planos ONG Essencial e Premium.'); return; }
  el.innerHTML = '<p style="color:#999;">Carregando...</p>';
  const ongId = ongScopeId();
  const [{ data: pets }, { data: reqs }] = await Promise.all([
    sb.from('pets').select('id, name, status, created_at').eq('ong_id', ongId),
    sb.from('adoption_requests').select('id, status, created_at, pet_id, pets!inner(name, ong_id)').eq('pets.ong_id', ongId)
  ]);
  const P = pets || [], R = reqs || [];
  const by = s => R.filter(r => r.status === s).length;
  const adopted = P.filter(p => p.status === 'adopted').length;
  const conv = R.length ? Math.round(by('completed') / R.length * 100) : 0;
  let html = `<div class="dashboard-stats">
    <div class="stat-card"><h4>Pets cadastrados</h4><p class="stat-number">${P.length}</p></div>
    <div class="stat-card"><h4>Pets adotados</h4><p class="stat-number">${adopted}</p></div>
    <div class="stat-card"><h4>Solicitações</h4><p class="stat-number">${R.length}</p></div>
    <div class="stat-card"><h4>Taxa de adoção</h4><p class="stat-number">${conv}%</p></div></div>`;
  if (plan !== 'premium') {
    el.innerHTML = html + lockHtml('Relatórios completos, painel de desempenho e exportação são do plano ONG Premium.');
    return;
  }
  const perPet = P.map(p => {
    const rs = R.filter(r => r.pet_id === p.id);
    return { name: p.name, status: p.status, requests: rs.length, completed: rs.filter(r => r.status === 'completed').length, days: daysSince(p.created_at) };
  }).sort((a, b) => b.requests - a.requests);
  const months = {};
  R.forEach(r => { const k = r.created_at.slice(0, 7); months[k] = (months[k] || 0) + 1; });
  const max = Math.max(1, ...Object.values(months));
  html += `<h3>Funil de adoção</h3><div class="commerce-row"><span>Pendentes: <b>${by('pending')}</b></span><span>Aprovadas: <b>${by('approved')}</b></span><span>Visita marcada: <b>${by('visit_scheduled')}</b></span><span>Concluídas: <b>${by('completed')}</b></span><span>Rejeitadas: <b>${by('rejected')}</b></span></div>
    <h3>Solicitações por mês</h3>${Object.keys(months).sort().map(k => `<div class="bar-row"><span>${k}</span><div class="adapt-bar" style="flex:1"><div style="width:${months[k] / max * 100}%"></div></div><b>${months[k]}</b></div>`).join('') || '<p style="color:#888;">Sem dados ainda.</p>'}
    <h3>Desempenho por pet</h3><table class="log-table"><tr><th>Pet</th><th>Situação</th><th>Solicitações</th><th>Adoções</th><th>Dias no site</th></tr>
    ${perPet.map(x => `<tr><td>${escapeHtml(x.name)}</td><td>${escapeHtml(x.status)}</td><td>${x.requests}</td><td>${x.completed}</td><td>${x.days}</td></tr>`).join('')}</table>
    <button class="btn-primary" style="margin-top:1rem;" onclick='exportReportCsv(${JSON.stringify(JSON.stringify(perPet)).replace(/'/g, "&#39;")})'>Baixar relatório (CSV)</button>`;
  el.innerHTML = html;
}

function exportReportCsv(json) {
  const rows = JSON.parse(json);
  const csv = ['Pet,Situação,Solicitações,Adoções,Dias no site'].concat(rows.map(r => [r.name, r.status, r.requests, r.completed, r.days].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(','))).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'relatorio-petmatch.csv';
  document.body.appendChild(a); a.click(); a.remove();
}

// ----- Equipe (Premium) -----
async function renderTeamTab() {
  const el = document.getElementById('teamContent');
  if (isOngMember()) { el.innerHTML = `<p>Você é administrador da ONG <b>${escapeHtml(ongScope.profile.name)}</b>. Você pode <button class="btn-secondary" onclick="leaveOngTeam()">sair da equipe</button>.</p>`; return; }
  if (ongPlan() !== 'premium') { el.innerHTML = lockHtml('Mais de um administrador é do plano ONG Premium.'); return; }
  const { data: members } = await sb.from('ong_members').select('id, member_id').eq('ong_id', currentUser.id);
  const ids = (members || []).map(m => m.member_id);
  const { data: profs } = ids.length ? await sb.from('profiles').select('id, name, email').in('id', ids) : { data: [] };
  const byId = Object.fromEntries((profs || []).map(p => [p.id, p]));
  el.innerHTML = `<p>Até 5 administradores extras. Eles precisam ter uma conta de ONG no PetMatch.</p>
    <form onsubmit="addTeamMember(event)" class="commerce-form"><input type="email" id="teamEmail" placeholder="E-mail do administrador" required><button class="btn-primary" type="submit">Adicionar</button></form>` +
    ((members || []).map(m => `<div class="commerce-row"><div><b>${escapeHtml((byId[m.member_id] || {}).name || 'Administrador')}</b><br><small>${escapeHtml((byId[m.member_id] || {}).email || '')}</small></div>
      <button class="btn-secondary" style="color:#c0392b;" onclick="removeTeamMember('${m.id}')">Remover</button></div>`).join('') || '<p style="color:#888;">Nenhum administrador extra.</p>');
}

async function addTeamMember(e) {
  e.preventDefault();
  const { error } = await sb.rpc('add_ong_member', { p_email: document.getElementById('teamEmail').value });
  if (error) { alert(error.message); return; }
  renderTeamTab();
}
async function removeTeamMember(id) {
  if (!confirm('Remover este administrador?')) return;
  const { error } = await sb.from('ong_members').delete().eq('id', id);
  if (error) { alert('Erro: ' + error.message); return; }
  renderTeamTab();
}
async function leaveOngTeam() {
  if (!confirm('Sair da equipe desta ONG?')) return;
  const { error } = await sb.from('ong_members').delete().eq('member_id', currentUser.id);
  if (error) { alert('Erro: ' + error.message); return; }
  await loadOngScope();
  switchAdminTab('dashboard');
}

// Link ?ong=<id> abre a página pública da ONG
document.addEventListener('DOMContentLoaded', () => {
  const id = new URLSearchParams(location.search).get('ong');
  if (id && /^[0-9a-f-]{36}$/i.test(id)) setTimeout(() => showOngPublic(id), 400);
});


// ============================================================================
// PREFEITURA e EMPRESA: painel próprio
// ============================================================================
const PLAN_FOR_ROLE_ADMIN = {
  adopter: ['free', 'plus'], ong: ['free', 'essencial', 'premium'],
  prefeitura: ['free', 'institucional'], empresa: ['free', 'parceira']
};

async function adminChangePlan(userId, plan) {
  const { error } = await sb.rpc('admin_set_plan', { p_user: userId, p_plan: plan });
  if (error) { alert('Erro: ' + error.message); renderAdminUsersList(); return; }
  alert('Plano alterado.');
}

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
  const plan = planOf(currentUser);
  document.getElementById('orgPanelTitle').textContent = role === 'prefeitura' ? 'Painel da Prefeitura' : 'Painel da Empresa';
  el.innerHTML = '<p style="color:#999;">Carregando...</p>';
  const mine = async table => (await sb.from(table).select('*').eq('owner_id', currentUser.id).order('created_at', { ascending: false })).data || [];
  const head = `<div class="ong-banner"><div><b>Plano: ${escapeHtml(PLAN_LABELS[plan] || plan)}</b><br><small>${role === 'prefeitura'
      ? (plan === 'institucional' ? 'Até 50 anúncios e indicadores do município.' : 'Até 2 anúncios. O plano institucional libera mais anúncios e indicadores.')
      : (plan === 'parceira' ? 'Até 5 empresas, 30 produtos e 10 anúncios.' : 'Até 1 empresa e 3 produtos. A Empresa Parceira libera anúncios, mais itens e destaque.')}</small></div>
      <button class="btn-secondary" onclick="showPage('my-plan')">Meu plano</button></div>
    <p class="compat-lock" style="background:#f2f7ff; border-color:#cfe0fb; color:#245;">Tudo o que você publica passa por aprovação do Supervisor ou do Administrador antes de aparecer no site.</p>`;

  if (role === 'prefeitura') {
    const ads = await mine('ads');
    let stats = '';
    if (plan === 'institucional') {
      const { data, error } = await sb.rpc('city_stats', { p_city: currentUser.city });
      stats = error ? `<p class="compat-lock">${escapeHtml(error.message)}</p>` : `<h3>Indicadores de ${escapeHtml(data.city)}</h3><div class="dashboard-stats">
        <div class="stat-card"><h4>Pets disponíveis</h4><p class="stat-number">${data.pets_available}</p></div>
        <div class="stat-card"><h4>Pets adotados</h4><p class="stat-number">${data.pets_adopted}</p></div>
        <div class="stat-card"><h4>ONGs na cidade</h4><p class="stat-number">${data.ongs}</p></div>
        <div class="stat-card"><h4>Adotadores</h4><p class="stat-number">${data.adopters}</p></div>
        <div class="stat-card"><h4>Solicitações</h4><p class="stat-number">${data.requests}</p></div>
        <div class="stat-card"><h4>Adoções concluídas</h4><p class="stat-number">${data.completed}</p></div></div>`;
    } else {
      stats = lockHtml('Os indicadores do município são do plano institucional.');
    }
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
      <input type="number" id="opDiscount" placeholder="Desconto para Adotador Plus (%)" min="0" max="50">
      <button class="btn-primary" type="submit">Enviar para aprovação</button></form>
    ${partners.map(x => ownRow('partners', x, x.name, `${PARTNER_CATEGORIES[x.category] || ''} • ${x.city} • 👁 ${x.views || 0} visualizações${x.plus_discount ? ' • ' + x.plus_discount + '% Plus' : ''}`)).join('')}
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
    ${plan === 'parceira' ? adFormHtml('empresa') : lockHtml('Anúncios são da Empresa Parceira.')}
    ${ads.map(x => ownRow('ads', x, x.title, `👁 ${x.views || 0} visualizações • 👆 ${x.clicks || 0} cliques`)).join('')}`;
}

async function saveOwnPartner(e) {
  e.preventDefault();
  const val = id => document.getElementById(id).value.trim();
  const cep = normCep(val('opCep'));
  if (cep && cep.length !== 8) { alert('O CEP deve ter 8 números.'); return; }
  const la = val('opLat'), lo = val('opLng');
  if ((la === '') !== (lo === '')) { alert('Preencha latitude e longitude juntas.'); return; }
  const disc = val('opDiscount') === '' ? null : parseInt(val('opDiscount'), 10);
  if (disc !== null && (isNaN(disc) || disc < 0 || disc > 50)) { alert('O desconto vai de 0 a 50%.'); return; }
  const row = { name: val('opName'), category: val('opCategory'), city: val('opCity'), cep: cep || null,
    latitude: la === '' ? null : parseFloat(la), longitude: lo === '' ? null : parseFloat(lo),
    address: val('opAddress') || null, phone: val('opPhone') || null, description: val('opDesc') || null,
    plus_discount: disc || null, owner_id: currentUser.id };
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
  const isAdmin = currentUser.user_type === 'admin';
  el.innerHTML = '<p style="color:#999;">Carregando...</p>';
  const { data, error } = await sb.rpc('admin_overview');
  if (error) { el.innerHTML = `<p class="compat-lock">${escapeHtml(error.message)}</p>`; return; }
  const card = (h, n) => `<div class="stat-card"><h4>${h}</h4><p class="stat-number">${n}</p></div>`;
  const users = data.users || {}, plans = data.plans || {};
  el.innerHTML = `<div class="dashboard-stats">
    ${card('Adotadores', users.adopter || 0)}${card('ONGs', users.ong || 0)}${card('Prefeituras', users.prefeitura || 0)}${card('Empresas', users.empresa || 0)}
    ${card('Pets', data.pets)}${card('Solicitações', data.requests)}${card('Adoções concluídas', data.completed)}${card('Conteúdos para aprovar', data.pending_content)}</div>
    <h3>Assinaturas ativas por plano</h3><div class="dashboard-stats">${Object.keys(plans).filter(k => k !== 'free').map(k => card(escapeHtml(PLAN_LABELS[k] || k), plans[k])).join('') || '<p style="color:#888;">Nenhuma assinatura ainda.</p>'}</div>
    ${isAdmin ? `<h3>Receita das assinaturas ativas</h3><p class="stat-number">${formatPrice(data.revenue || 0)}</p><small style="color:#888;">Pagamento simulado nesta versão: o valor mostra o que seria cobrado.</small>` : ''}`;
}
