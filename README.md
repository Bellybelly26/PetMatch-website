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

### Geral
- ✅ Design responsivo (mobile, tablet, desktop)
- ✅ Seção "Como Funciona", com o passo a passo para adotadores e para ONGs
- ✅ Carrossel de histórias de sucesso (navegação manual, sem troca automática)
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
5. `supabase-seed-pets-exemplo.sql` *(opcional)* — cadastra alguns pets de exemplo para teste (é necessário trocar o `ong_id` pelo id de uma ONG já cadastrada)

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

## 🎓 Projeto Acadêmico

PetMatch é um projeto desenvolvido como **Trabalho de Conclusão de Curso (TCC)**, combinando tecnologia web moderna, banco de dados na nuvem, design responsivo, responsabilidade social e bem-estar animal.

---

**Desenvolvido com ❤️ para conectar animais com famílias amorosas** 🐾
