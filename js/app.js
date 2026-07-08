// ============================================================================
// CONFIGURAÇÃO CENTRALIZADA DO SUPABASE
// ============================================================================
const SUPABASE_URL = "sb_publishable_qkAJHEVU8XZfGXSUeNJLfA_43T8HGy_"; 
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uYWt5cGR3a2dxZmp4YWlyc3RkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3MzQxMzMsImV4cCI6MjA5NzMxMDEzM30.YeTSG2SvzNaWVbGShXVD90sYP72plAyhtmgfswK4fx8"; 

const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let usuarioLogado = null;

// ============================================================================
// AUTENTICAÇÃO E RELACIONAMENTO ENTRE TABELAS (usuarios, adotadores, ongs)
// ============================================================================

// Monitora o estado da sessão de usuário em tempo real
supabase.auth.onAuthStateChange((event, session) => {
    if (session) {
        usuarioLogado = session.user;
        document.getElementById('menu-autenticacao').style.display = 'none';
        document.getElementById('menu-usuario').style.display = 'block';
        document.getElementById('aviso-autenticacao-painel').style.display = 'none';
        document.getElementById('conteudo-painel-protegido').style.display = 'block';
        carregarDadosPainel();
    } else {
        usuarioLogado = null;
        document.getElementById('menu-autenticacao').style.display = 'block';
        document.getElementById('menu-usuario').style.display = 'none';
        document.getElementById('aviso-autenticacao-painel').style.display = 'block';
        document.getElementById('conteudo-painel-protegido').style.display = 'none';
    }
});

// Evento de Login (Validação + Autenticação)
document.getElementById('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const senha = document.getElementById('login-senha').value;

    if (!email || !senha) {
        alert("Preencha todos os campos obrigatórios.");
        return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });

    if (error) {
        alert("Erro de autenticação: " + error.message);
    } else {
        alert("Acesso concedido com sucesso!");
        alternarTela('inicio');
    }
});

// Evento de Cadastro Transacional (Auth -> usuarios -> adotadores/ongs)
document.getElementById('form-cadastro').addEventListener('submit', async (e) => {
    e.preventDefault();
    const tipo = document.getElementById('cad-tipo').value; // 'adotador' ou 'ong'
    const nome = document.getElementById('cad-nome').value.trim();
    const email = document.getElementById('cad-email').value.trim();
    const senha = document.getElementById('cad-senha').value;

    // Validações estruturais de integridade
    if (nome.length < 3) {
        alert("O nome precisa conter pelo menos 3 caracteres.");
        return;
    }
    if (senha.length < 6) {
        alert("A senha precisa conter no mínimo 6 dígitos.");
        return;
    }

    // 1. Cria credencial de login oficial no Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({ email, password: senha });

    if (authError) {
        alert("Erro no serviço de autenticação: " + authError.message);
        return;
    }

    if (authData.user) {
        const userId = authData.user.id;

        // 2. Insere o registro centralizador na tabela 'usuarios'
        const { error: userTableError } = await supabase
            .from('usuarios')
            .insert([{ id: userId, email: email, tipo_usuario: tipo }]);

        if (userTableError) {
            alert("Erro ao sincronizar tabela 'usuarios': " + userTableError.message);
            return;
        }

        // 3. Destina as informações complementares para a tabela correta ('adotadores' ou 'ongs')
        const tabelaDestino = tipo === 'adotador' ? 'adotadores' : 'ongs';
        const { error: perfilError } = await supabase
            .from(tabelaDestino)
            .insert([{ id: userId, nome: nome }]);

        if (perfilError) {
            alert(`Usuário criado, mas falhou ao alimentar dados na tabela '${tabelaDestino}': ` + perfilError.message);
        } else {
            alert("Cadastro concluído com sucesso em todas as tabelas! Realize o login.");
            document.getElementById('form-cadastro').reset();
            alternarAbasAuth('login');
        }
    }
});

// Encerramento de sessão
async function deslogarUsuario() {
    await supabase.auth.signOut();
    alert("Sessão finalizada.");
    alternarTela('inicio');
}

// ============================================================================
// CRUD OPERAÇÕES: TABELA [pets]
// ============================================================================

// GET - Listar todos os pets para adoção na vitrine pública
async function carregarPets() {
    const container = document.getElementById('container-vitrine-pets');
    container.innerHTML = "<p>Buscando lista de pets ativos...</p>";

    const { data, error } = await supabase.from('pets').select('*');

    if (error) {
        container.innerHTML = `<p style="color:red;">Falha na leitura dos dados: ${error.message}</p>`;
        return;
    }

    container.innerHTML = "";
    if (data.length === 0) {
        container.innerHTML = "<p>Nenhum pet cadastrado para adoção no momento.</p>";
        return;
    }

    data.forEach(pet => {
        const card = document.createElement('div');
        card.style = "border: 1px solid #ddd; border-radius: 8px; padding: 15px; width: 220px; text-align: center; box-shadow: 0 4px 6px rgba(0,0,0,0.05); background:#fff;";
        card.innerHTML = `
            <div style="font-size: 40px; margin-bottom: 10px;">🐾</div>
            <h3>${pet.nome}</h3>
            <p><strong>Espécie:</strong> ${pet.especie}</p>
            <p><strong>Idade:</strong> ${pet.idade} ano(s)</p>
            <button onclick="criarSolicitacaoAdocao('${pet.id}')" style="background-color:#28a745; color:white; border:none; padding:8px 12px; border-radius:4px; cursor:pointer; width:100%; font-weight:bold; margin-top:10px;">Quero Adotar</button>
        `;
        container.appendChild(card);
    });
}

// POST & PUT - Criação ou Edição de Pets
document.getElementById('form-crud-pet').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('pet-id-edicao').value;
    const nome = document.getElementById('pet-nome').value.trim();
    const especie = document.getElementById('pet-especie').value.trim();
    const idade = parseInt(document.getElementById('pet-idade').value);

    if (id) {
        // Atualização cadastral (PUT)
        const { error } = await supabase.from('pets').update({ nome, especie, idade }).eq('id', id);
        if (error) alert("Erro ao atualizar registro do pet: " + error.message);
        else alert("Alterações gravadas com sucesso!");
    } else {
        // Criação de novo pet (POST)
        const { error } = await supabase.from('pets').insert([{ nome, especie, idade }]);
        if (error) alert("Erro ao inserir novo pet: " + error.message);
        else alert("Pet inserido no sistema com sucesso!");
    }

    limparFormularioPet();
    carregarDadosPainel();
    carregarPets();
});

// DELETE - Remover pet definitivamente da tabela
async function deletarPet(id) {
    if (!confirm("Confirmar exclusão permanente deste pet?")) return;

    const { error } = await supabase.from('pets').delete().eq('id', id);
    if (error) alert("Não foi possível excluir: " + error.message);
    else {
        alert("Pet excluído com sucesso.");
        carregarDadosPainel();
        carregarPets();
    }
}

// Passar dados da listagem para as caixas de texto para edição
function iniciarEdicaoPet(id, nome, especie, idade) {
    document.getElementById('pet-id-edicao').value = id;
    document.getElementById('pet-nome').value = nome;
    document.getElementById('pet-especie').value = especie;
    document.getElementById('pet-idade').value = idade;
    document.getElementById('btn-salvar-pet').innerText = "Atualizar Registro (PUT)";
    document.getElementById('btn-cancelar-pet').style.display = "inline-block";
}

function limparFormularioPet() {
    document.getElementById('form-crud-pet').reset();
    document.getElementById('pet-id-edicao').value = "";
    document.getElementById('btn-salvar-pet').innerText = "Salvar Registro";
    document.getElementById('btn-cancelar-pet').style.display = "none";
}

// ============================================================================
// CRUD OPERAÇÕES: TABELA [solicitacoes_adocao]
// ============================================================================

// POST - Criar uma solicitação vinculada ao ID do Pet
async function criarSolicitacaoAdocao(idPet) {
    const nomeAdotador = prompt("Por favor, digite seu Nome Completo para registrar a solicitação:");
    const contato = prompt("Digite seu Telefone ou E-mail para que a ONG retorne:");

    if (!nomeAdotador || !contato) {
        alert("Operação negada. Informações para contato são obrigatórias.");
        return;
    }

    const { error } = await supabase.from('solicitacoes_adocao').insert([
        { pet_id: idPet, nome_solicitante: nomeAdotador, dados_contato: contato, status: "Em Análise" }
    ]);

    if (error) alert("Falha ao registrar intenção de adoção: " + error.message);
    else alert("Sua solicitação foi registrada! Acompanhe no painel de controle.");
}

// PUT - Alterar o status (Aprovar / Recusar pedido de adoção)
async function alterarStatusSolicitacao(idSolicitacao, statusAtualizado) {
    const { error } = await supabase.from('solicitacoes_adocao').update({ status: statusAtualizado }).eq('id', idSolicitacao);
    if (error) alert("Erro ao atualizar status do pedido: " + error.message);
    else {
        alert(`Status atualizado para: ${statusAtualizado}`);
        carregarDadosPainel();
    }
}

// DELETE - Remover pedido da listagem administrativaasync function recusarEDeletarSolicitacao(idSolicitacao) {if (!confirm("Deseja expurgar essa solicitação do histórico?")) return;const { error } = await supabase.from('solicitacoes_adocao').delete().eq('id', idSolicitacao);if (error) alert("Erro ao excluir: " + error.message);else {alert("Solicitação excluída com sucesso.");carregarDadosPainel();}}// ============================================================================// SISTEMA DE RENDERIZAÇÃO DO PAINEL GERAL (GET COMBINADO)// ============================================================================async function carregarDadosPainel() {if (!usuarioLogado) return;// 1. Atualizar Tabela de Controle de Petsconst tbodyPets = document.querySelector('#tabela-gerencia-pets tbody');tbodyPets.innerHTML = "Sincronizando...";const { data: listagemPets, error: errPets } = await supabase.from('pets').select('*');if (!errPets && listagemPets) {tbodyPets.innerHTML = "";listagemPets.forEach(p => {const tr = document.createElement('tr');tr.innerHTML = <td style="padding: 8px;">${p.nome}</td> <td style="padding: 8px;">${p.especie}</td> <td style="padding: 8px;"> <button onclick="iniciarEdicaoPet('${p.id}', '${p.nome}', '${p.especie}', ${p.idade})" style="color: blue; cursor:pointer; background:none; border:none; padding:0 5px;">Editar</button> <button onclick="deletarPet('${p.id}')" style="color: red; cursor:pointer; background:none; border:none; padding:0 5px;">Excluir</button> </td>;tbodyPets.appendChild(tr);});}// 2. Atualizar Tabela de Solicitações de Adoçãoconst tbodySolicitacoes = document.querySelector('#tabela-gerencia-solicitacoes tbody');tbodySolicitacoes.innerHTML = "Sincronizando...";const { data: listagemSolicitacoes, error: errSolicitacoes } = await supabase.from('solicitacoes_adocao').select('*');if (!errSolicitacoes && listagemSolicitacoes) {tbodySolicitacoes.innerHTML = "";listagemSolicitacoes.forEach(s => {const tr = document.createElement('tr');tr.innerHTML = <td style="padding: 8px;">${s.nome_solicitante}</td> <td style="padding: 8px;">${s.dados_contato}</td> <td style="padding: 8px; font-weight:bold;">${s.status}</td> <td style="padding: 8px;"> <button onclick="alterarStatusSolicitacao('${s.id}', 'Aprovada')" style="color: green; cursor:pointer; background:none; border:none;">Aceitar</button> <button onclick="alterarStatusSolicitacao('${s.id}', 'Recusada')" style="color: orange; cursor:pointer; background:none; border:none; margin: 0 4px;">Recusar</button> <button onclick="recusarEDeletarSolicitacao('${s.id}')" style="color: red; cursor:pointer; background:none; border:none; font-weight:bold;">X</button> </td>;tbodySolicitacoes.appendChild(tr);});}}// ============================================================================// NAVEGAÇÃO E REGRAS DE ALTERNÂNCIA DE TELAS// ============================================================================function alternarTela(idTela) {document.querySelectorAll('.section-container').forEach(sec => sec.style.display = 'none');document.getElementById(tela-${idTela}).style.display = 'block';if (idTela === 'animais') carregarPets();if (idTela === 'gerenciamento') carregarDadosPainel();}function alternarAbasAuth(aba) {if (aba === 'login') {document.getElementById('form-login').style.display = 'block';document.getElementById('form-cadastro').style.display = 'none';document.getElementById('btn-tab-login').style.fontWeight = 'bold';document.getElementById('btn-tab-cadastro').style.fontWeight = 'normal';} else {document.getElementById('form-login').style.display = 'none';document.getElementById('form-cadastro').style.display = 'block';document.getElementById('btn-tab-login').style.fontWeight = 'normal';document.getElementById('btn-tab-cadastro').style.fontWeight = 'bold';}}// Inicialização automática ao carregar a páginawindow.addEventListener('DOMContentLoaded', () => {carregarPets();});
