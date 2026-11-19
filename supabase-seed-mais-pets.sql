-- ============================================================================
-- PetMatch: mais pets para a tela inicial e o Explorar Pets (32 pets, com bairro e posição no mapa)
-- Rode DEPOIS de supabase-add-bairros-perdidos.sql. Cadastra os pets na primeira ONG encontrada.
-- Pode rodar mais de uma vez (não repete o mesmo pet). As fotos são images/cachorro.jpg ... passaro5.jpg (5 por tipo);
-- se rodar de novo, a foto dos pets já cadastrados também é atualizada.
-- Para usar outra ONG: troque "limit 1" por "and email = 'email-da-ong@exemplo.com'" na linha do select.
-- ============================================================================
do $$
declare
  v_ong uuid;
begin
  select id into v_ong from public.profiles where user_type = 'ong' order by created_at limit 1;
  if v_ong is null then
    raise exception 'Cadastre uma conta de ONG no site antes de rodar este script.';
  end if;

  create temp table _novos_pets on commit drop as
  select * from (values
  ('Bob', 'dog', 'Vira-lata', 3, 'medium', 'Alta', 'Curitiba', 'Batel', -25.4425, -49.281, 'images/cachorro.jpg', 'Cheio de energia, adora correr no parque.'),
  ('Fred', 'dog', 'Beagle', 4, 'medium', 'Moderada', 'Curitiba', 'Água Verde', -25.454, -49.269, 'images/cachorro2.jpg', 'Companheiro, bom com crianças e outros cães.'),
  ('Pipoca', 'dog', 'Poodle', 2, 'small', 'Alta', 'Curitiba', 'Centro', -25.4284, -49.2733, 'images/cachorro3.jpg', 'Alegre e esperta, aprende truques rápido.'),
  ('Mel', 'dog', 'Vira-lata', 1, 'small', 'Alta', 'Curitiba', 'Portão', -25.477, -49.295, 'images/cachorro4.jpg', 'Filhote brincalhona, ainda aprendendo a passear de coleira.'),
  ('Toby', 'dog', 'Golden Retriever', 6, 'large', 'Moderada', 'Curitiba', 'Santa Felicidade', -25.401, -49.327, 'images/cachorro5.jpg', 'Dócil e calmo, ótimo para famílias.'),
  ('Nina', 'dog', 'Shih Tzu', 5, 'small', 'Baixa', 'Curitiba', 'Bigorrilho', -25.434, -49.29, 'images/cachorro.jpg', 'Tranquila, ideal para apartamento.'),
  ('Bela', 'dog', 'Vira-lata', 2, 'medium', 'Moderada', 'Curitiba', 'Boa Vista', -25.386, -49.25, 'images/cachorro2.jpg', 'Carinhosa e muito sociável.'),
  ('Zeca', 'dog', 'Pastor Alemão', 7, 'large', 'Moderada', 'Curitiba', 'Cajuru', -25.454, -49.22, 'images/cachorro3.jpg', 'Leal e protetor, precisa de espaço para se exercitar.'),
  ('Pingo', 'dog', 'Pinscher', 3, 'small', 'Alta', 'Curitiba', 'Cabral', -25.409, -49.257, 'images/cachorro4.jpg', 'Pequeno e corajoso, adora colo.'),
  ('Lupi', 'dog', 'Vira-lata', 8, 'medium', 'Baixa', 'Curitiba', 'Hauer', -25.465, -49.25, 'images/cachorro5.jpg', 'Idosinha tranquila que só quer um cantinho quentinho.'),
  ('Duque', 'dog', 'Labrador', 2, 'large', 'Alta', 'Curitiba', 'Xaxim', -25.501, -49.26, 'images/cachorro.jpg', 'Brincalhão, adora água e bolinhas.'),
  ('Maya', 'dog', 'Vira-lata', 4, 'medium', 'Moderada', 'Curitiba', 'Pinheirinho', -25.52, -49.285, 'images/cachorro2.jpg', 'Equilibrada e obediente, vai bem com crianças.'),
  ('Thor Jr.', 'dog', 'Vira-lata', 1, 'medium', 'Alta', 'São José dos Pinhais', 'Centro', -25.5313, -49.2064, 'images/cachorro3.jpg', 'Filhote curioso e cheio de vontade de brincar.'),
  ('Caramelo', 'dog', 'Vira-lata', 5, 'medium', 'Moderada', 'Londrina', 'Centro', -23.3103, -51.1628, 'images/cachorro4.jpg', 'Simpático, se dá bem com todo mundo.'),
  ('Estrela', 'dog', 'Border Collie', 3, 'medium', 'Alta', 'Maringá', 'Centro', -23.4205, -51.9331, 'images/cachorro5.jpg', 'Muito inteligente, precisa de atividades diárias.'),
  ('Mingau', 'cat', 'Siamês', 2, 'small', 'Moderada', 'Curitiba', 'Batel', -25.4425, -49.281, 'images/gato.jpg', 'Miador e carinhoso, adora janela.'),
  ('Tigre', 'cat', 'Vira-lata', 3, 'small', 'Alta', 'Curitiba', 'Água Verde', -25.454, -49.269, 'images/gato2.jpg', 'Explorador, gosta de brinquedos de caçar.'),
  ('Nala', 'cat', 'Angorá', 4, 'small', 'Baixa', 'Curitiba', 'Centro', -25.4284, -49.2733, 'images/gato3.jpg', 'Calma e dócil, gosta de dormir no sofá.'),
  ('Simba', 'cat', 'Vira-lata', 1, 'small', 'Alta', 'Curitiba', 'Portão', -25.477, -49.295, 'images/gato4.jpg', 'Filhote brincalhão e muito curioso.'),
  ('Lili', 'cat', 'Persa', 6, 'small', 'Baixa', 'Curitiba', 'Bigorrilho', -25.434, -49.29, 'images/gato5.jpg', 'Elegante e tranquila, prefere ambiente silencioso.'),
  ('Mimi', 'cat', 'Vira-lata', 2, 'small', 'Moderada', 'Ponta Grossa', 'Centro', -25.095, -50.162, 'images/gato.jpg', 'Carinhosa, dorme grudadinha no dono.'),
  ('Oliver', 'cat', 'Vira-lata', 3, 'small', 'Moderada', 'Cascavel', 'Centro', -24.9558, -53.4552, 'images/gato2.jpg', 'Sociável, convive bem com outros gatos.'),
  ('Piu', 'bird', 'Calopsita', 1, 'small', 'Alta', 'Curitiba', 'Cabral', -25.409, -49.257, 'images/passaro.jpg', 'Assobia melodias e adora atenção.'),
  ('Sol', 'bird', 'Periquito', 2, 'small', 'Alta', 'Foz do Iguaçu', 'Centro', -25.5469, -54.5882, 'images/passaro2.jpg', 'Muito ativo e comunicativo.'),
  ('Algodão', 'rabbit', 'Mini Lop', 2, 'small', 'Baixa', 'Curitiba', 'Boa Vista', -25.386, -49.25, 'images/coelho.jpg', 'Dócil, gosta de carinho e de cenoura.'),
  ('Cenoura', 'rabbit', 'Coelho comum', 1, 'small', 'Moderada', 'Londrina', 'Centro', -23.3103, -51.1628, 'images/coelho2.jpg', 'Pula o dia todo e é muito curioso.'),
  ('Lola', 'bird', 'Calopsita', 2, 'small', 'Alta', 'Curitiba', 'Água Verde', -25.454, -49.269, 'images/passaro3.jpg', 'Assobia o dia todo e gosta de ficar no ombro.'),
  ('Bento', 'bird', 'Periquito', 1, 'small', 'Moderada', 'Curitiba', 'Portão', -25.477, -49.295, 'images/passaro4.jpg', 'Calmo, aprende a se empoleirar no dedo.'),
  ('Cacau', 'bird', 'Agapornis', 3, 'small', 'Alta', 'São José dos Pinhais', 'Centro', -25.5313, -49.2064, 'images/passaro5.jpg', 'Muito carinhoso e animado.'),
  ('Floquinho', 'rabbit', 'Mini Rex', 1, 'small', 'Moderada', 'Curitiba', 'Batel', -25.4425, -49.281, 'images/coelho3.jpg', 'Curioso, adora explorar a casa.'),
  ('Nuvem', 'rabbit', 'Anão', 3, 'small', 'Baixa', 'Curitiba', 'Hauer', -25.465, -49.25, 'images/coelho4.jpg', 'Tranquilo e muito dócil.'),
  ('Pipa', 'rabbit', 'Coelho comum', 2, 'small', 'Moderada', 'Maringá', 'Centro', -23.4205, -51.9331, 'images/coelho5.jpg', 'Brincalhona, gosta de pular e de verduras frescas.')
  ) as v(name, type, breed, age, size, energy, city, neighborhood, lat, lng, image_url, temperament);

  insert into public.pets (ong_id, name, type, breed, age, size, energy, city, neighborhood, state, lat, lng,
                           image_url, vaccinated, neutered, dewormed, temperament, status)
  select v_ong, v.name, v.type, v.breed, v.age, v.size, v.energy, v.city, v.neighborhood, 'PR', v.lat, v.lng,
         v.image_url, true, true, true, v.temperament, 'available'
  from _novos_pets v
  where not exists (
    select 1 from public.pets p where p.ong_id = v_ong and p.name = v.name and p.city = v.city
  );

  -- se os pets já tinham sido cadastrados, só atualiza a foto
  update public.pets p set image_url = v.image_url
  from _novos_pets v
  where p.ong_id = v_ong and p.name = v.name and p.city = v.city;
end $$;
