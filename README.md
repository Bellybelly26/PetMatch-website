# 🐾 PetMatch - Conectando Corações e Patas

Plataforma web para adoção de animais de estimação, conectando adotadores com ONGs de forma segura, transparente e responsável. Projeto acadêmico (TCC) desenvolvido com HTML, CSS e JavaScript no frontend, e **Supabase** (PostgreSQL + Auth + Storage) como backend.

## 📋 Funcionalidades

### Para Adotadores
- ✅ Cadastro e login com autenticação real (Supabase Auth)
- ✅ Visualizar pets disponíveis, com foto, vídeo, saúde e comportamento
- ✅ Filtrar por tipo de animal, tamanho e localização
- ✅ Adicionar pets aos favoritos
- ✅ Solicitar adoção e acompanhar por uma **barra de progresso** (Solicitado → Aprovado → Visita agendada → Adotado)
- ✅ **Notificações** automáticas a cada mudança de status da solicitação
- ✅ Perfil com upload de foto e de fotos/vídeos da residência
- ✅ Ver contato da ONG responsável por cada solicitação
- ✅ Chat de suporte (perguntas frequentes) para tirar dúvidas sobre o uso do site

### Para ONGs
- ✅ Cadastro e login
- ✅ Painel administrativo com dashboard de estatísticas
- ✅ CRUD completo de pets (adicionar, editar, excluir), incluindo foto, vídeo, dados de saúde (vacinado, castrado, vermifugado) e comportamento
- ✅ Visualizar e gerenciar solicitações de adoção
- ✅ Aprovar ou rejeitar solicitações
- ✅ Agendar visitas pré-adoção
- ✅ Concluir a adoção (marca o pet como adotado)

### Planos anuais (pagamento simulado)
- **Adotador Plus** (R$ 49,90/ano): compatibilidade avançada, Meus Pets (carteirinha digital, histórico de saúde, lembretes, diário de evolução), pets novos 24h antes, descontos, sem anúncios, suporte prioritário.
- **ONG Essencial** (R$ 119,90/ano): até 30 pets, selo de ONG Verificada, conversa com adotantes, estatísticas, página própria e cartão de divulgação.
- **ONG Premium** (R$ 199,90/ano): até 100 pets, destaque, relatórios completos e CSV, visitas/entrevistas, acompanhamento, equipe (até 5 administradores extras), Pix, eventos e modelos de documentos.
- **Empresa Parceira** (R$ 499/ano): mais empresas e produtos, anúncios e destaque. **Prefeitura institucional**: sob proposta (anúncios, indicadores do município).
- Gratuito para todos os perfis. Conteúdo de Prefeitura e Empresa passa por aprovação do Supervisor/Administrador.

### Hierarquia de acesso (Administrador > Supervisor > Usuário)
| Nível | Quem é | O que pode fazer |
|---|---|---|
| **Administrador** | Conta criada pela equipe via SQL | Controle total: verificar, bloquear e excluir contas; promover um Usuário a Supervisor e remover a supervisão |
| **Supervisor** | Promovido pelo Administrador | Moderar Usuários: verificar e bloquear/desbloquear (não exclui, não promove) |
| **Usuário** | Cadastro público (Adotador ou ONG) | Adotador: explorar, favoritar, solicitar adoção e acompanhar. ONG: gerenciar pets, solicitações e visitas |

- Administrador e Supervisor entram pelo mesmo login e veem o **Painel ADM** / **Painel do Supervisor** no menu do perfil, com o papel exibido no topo do menu.
- O cadastro público só cria Usuários; Supervisor e Administrador nunca são criados pelo site aberto.
- As regras são aplicadas no banco (RLS + trigger `protect_profile_privileged_columns`), não só na tela.

### Geral
- ✅ Design responsivo (mobile, tablet, desktop)
- ✅ Seção "Como Funciona", com o passo a passo para adotadores e para ONGs
- ✅ Página inicial com **Explorar Pets** (pets reais do banco) e uma animação do processo de adoção
- ✅ Carrossel de histórias de sucesso na página Sobre (navegação manual, sem troca automática)
- ✅ **Controle de histórico:** linha do tempo de cada solicitação de adoção ("Ver histórico"), para Adotador e ONG
- ✅ **Ajuda e Reclamações:** perguntas frequentes e formulário (ajuda, reclamação ou sugestão); Administrador e Supervisor respondem pelo painel
- ✅ **Log de sistema:** registro de auditoria (acessos, solicitações, moderação, pets, mensagens e LGPD), visível só ao Administrador, com filtro e download em CSV; ninguém altera nem apaga os registros
- ✅ **Filtro de pets por CEP**, **Parceiros perto de você** (por cidade, CEP e categoria, com destaque pago), **anúncios** da prefeitura e de empresas (com explicação, local e link para o mapa) e distância até o parceiro quando o usuário permite a localização do navegador (não é guardada) e **Lojinha** (vitrine); tudo gerenciado pelo Administrador e Supervisor no painel
- ✅ **Planos anuais:** Adotador Grátis e Plus (R$ 49,90/ano), ONG Grátis, Essencial (R$ 119,90/ano) e Premium (R$ 199,90/ano), Empresa Parceira e plano institucional para prefeituras (modelo de negócio do TCC; valores de exemplo e pagamento simulado; recursos novos marcados "em breve")
- ✅ **LGPD:** Política de Privacidade, consentimento no cadastro (registrado com data e versão), aviso de armazenamento no navegador, página "Meus Dados" para baixar os dados (JSON) e excluir a própria conta
- ✅ Estatísticas da home com dados reais do banco (pets adotados, disponíveis e famílias felizes)
- ✅ Depoimentos rotativos
- ✅ Segurança via Row Level Security (RLS) no banco de dados

## 🧱 Arquitetura e Tecnologias

| Camada | Tecnologia |
|---|---|
| Frontend | HTML5, CSS3, JavaScript (Vanilla, sem frameworks) |
| Backend / Banco de dados | [Supabase](https://supabase.com) (PostgreSQL) |
| Autenticação | Supabase Auth (e-mail/senha) |
| Armazenamento de arquivos | Supabase Storage (fotos e vídeos de pets e usuários) |
| Hospedagem | GitHub Pages |

O frontend se conecta diretamente ao Supabase pelo SDK `@supabase/supabase-js`, sem necessidade de um servidor próprio — o Supabase cumpre o papel de backend (API + banco de dados + autenticação + armazenamento de arquivos).

## 🚀 Como Executar o Sistema

### Opção 1 — Acessar o sistema já publicado
O sistema já está publicado via GitHub Pages. Basta acessar o link informado na entrega do projeto — não é necessário instalar nada.

### Opção 2 — Rodar localmente

**1. Clone o repositório**
```bash
git clone https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
cd SEU-REPOSITORIO
```

**2. Configure o banco de dados no Supabase**

Crie um projeto gratuito em [supabase.com](https://supabase.com/dashboard), abra o **SQL Editor** e execute, **nesta ordem**, os scripts da raiz do projeto:

1. `supabase-schema.sql` — cria as tabelas principais (`profiles`, `pets`, `favorites`, `adoption_requests`, `visits`)
2. `supabase-policies-and-trigger.sql` — cria as políticas de segurança (RLS), os buckets de armazenamento e o trigger que gera o perfil do usuário automaticamente no cadastro
3. `supabase-add-video.sql` — adiciona o campo de vídeo aos pets
4. `supabase-add-progress-health-notifications.sql` — adiciona os campos de saúde/comportamento do pet, os status da barra de progresso e a tabela de notificações
5. `supabase-add-admin-and-verification.sql` — adiciona Painel ADM (verificar, bloquear, excluir) e a verificação em duas etapas
6. `supabase-add-supervisor-hierarchy.sql` — adiciona o nível Supervisor e as travas da hierarquia Administrador > Supervisor > Usuário
7. `supabase-add-history-logs-help-lgpd.sql` — adiciona histórico das solicitações, log de sistema, ajuda e reclamações e LGPD
8. `supabase-add-partners-ads-shop.sql` — adiciona CEP (pets, parceiros e perfil), parceiros por localização, anúncios (prefeitura e empresas) e lojinha, com dados de exemplo
9. `supabase-add-plans-roles-features.sql` — planos anuais (assinatura simulada), perfis Prefeitura e Empresa, aprovação de conteúdo, equipe da ONG, chat, eventos, carteirinha/saúde/diário, relatórios e visão geral
9. `supabase-seed-pets-exemplo.sql` *(opcional)* — cadastra alguns pets de exemplo para teste (é necessário trocar o `ong_id` pelo id de uma ONG já cadastrada)

**3. Configure as credenciais do projeto**

Em `js/script.js`, atualize as constantes no topo do arquivo com os dados do **seu** projeto Supabase (em *Settings → API* no painel do Supabase):

```js
const SUPABASE_URL = "https://SEU-PROJETO.supabase.co";
const SUPABASE_ANON_KEY = "sua-anon-key-aqui";
```

**4. Abra o site**

Basta abrir o arquivo `index.html` no navegador, ou servir a pasta com um servidor local:
```bash
# Com Python 3
python -m http.server 8000

# Com Node.js
npx http-server
```
Depois acesse `http://localhost:8000`.

## 📁 Estrutura do Projeto

```
PetMatch-website-main/
├── index.html                                          # Estrutura principal do site
├── css/
│   └── styles.css                                      # Estilos visuais
├── js/
│   └── script.js                                       # Lógica da aplicação e integração com Supabase
├── images/                                              # Imagens estáticas do site
├── supabase-schema.sql                                  # Script 1: tabelas do banco
├── supabase-policies-and-trigger.sql                    # Script 2: segurança (RLS), storage e trigger
├── supabase-add-video.sql                                # Script 3: campo de vídeo dos pets
├── supabase-add-progress-health-notifications.sql        # Script 4: saúde, progresso e notificações
├── supabase-add-admin-and-verification.sql               # Script 5: Painel ADM e verificação em duas etapas
├── supabase-add-supervisor-hierarchy.sql                 # Script 6: hierarquia Administrador > Supervisor > Usuário
├── supabase-add-history-logs-help-lgpd.sql               # Script 7: histórico, log de sistema, ajuda e reclamações e LGPD
├── supabase-add-partners-ads-shop.sql                    # Script 8: CEP, parceiros, anúncios e lojinha
├── supabase-add-plans-roles-features.sql                 # Script 9: planos, perfis e recursos pagos
├── supabase-seed-pets-exemplo.sql                        # Script opcional: pets de exemplo
└── README.md                                             # Este arquivo
```

## 🗄️ Modelo de Dados (resumo)

- **profiles** — dados de adotadores e ONGs (1 para 1 com o usuário autenticado)
- **pets** — animais cadastrados por uma ONG, com dados de saúde e comportamento
- **favorites** — relação N:N entre adotadores e pets favoritados
- **adoption_requests** — solicitações de adoção, com status (`pending`, `approved`, `rejected`, `visit_scheduled`, `completed`)
- **visits** — visitas pré-adoção agendadas pela ONG
- **notifications** — notificações enviadas ao adotador a cada mudança de status
- **request_history** — histórico de cada mudança de status das solicitações (gravado por gatilho)
- **system_logs** — log de auditoria do sistema (gravado por gatilhos; só o Administrador lê)
- **complaints** — mensagens de ajuda, reclamações e sugestões, com a resposta da moderação

Todas as tabelas usam **Row Level Security (RLS)**: cada usuário só acessa e modifica os dados que lhe pertencem (ex.: uma ONG só edita seus próprios pets; um adotador só vê suas próprias solicitações e notificações).

## 🔄 Fluxo de Uso

### Como Adotador
1. Clique em "Entrar" → "Adotador" → cadastre-se ou faça login
2. Explore os pets disponíveis na aba "Pets"
3. Favorite os que mais gostar e veja os detalhes (saúde, comportamento, vídeo)
4. Clique em "Quero Adotar!"
5. Acompanhe sua solicitação pela barra de progresso e pelas notificações

### Como ONG
1. Clique em "Entrar" → "ONG" → cadastre-se ou faça login
2. Acesse o "Painel ONG"
3. Cadastre seus pets (foto, vídeo, saúde, comportamento)
4. Gerencie as solicitações recebidas: aprove, agende visita e conclua a adoção

### Como Administrador ou Supervisor
1. Entre com a conta (Administrador ou Supervisor) pelo login normal
2. Abra o menu do perfil → "Painel ADM" (ou "Painel do Supervisor")
3. Verifique ou bloqueie contas; o Administrador também exclui e promove a Supervisor

## 🎓 Projeto Acadêmico

PetMatch é um projeto desenvolvido como **Trabalho de Conclusão de Curso (TCC)**, combinando tecnologia web moderna, banco de dados na nuvem, design responsivo, responsabilidade social e bem-estar animal.

---

**Desenvolvido com ❤️ para conectar animais com famílias amorosas** 🐾
