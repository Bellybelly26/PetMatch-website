-- Troque 'COLOQUE_O_ID_AQUI' pelo id da sua ONG (veja com o select abaixo)
-- select id, name, city from public.profiles where user_type = 'ong';

insert into public.pets (ong_id, name, type, breed, age, size, energy, city, image_url, vaccinated, neutered, dewormed, temperament, status)
values
  ('COLOQUE_O_ID_AQUI', 'Rex', 'dog', 'Vira-lata', 2, 'medium', 'Alta', 'Curitiba', 'images/pet-dog-brown-1.png', true, true, true, 'Muito brincalhão e sociável com outros cães.', 'available'),
  ('COLOQUE_O_ID_AQUI', 'Thor', 'dog', 'Labrador', 5, 'large', 'Moderada', 'Curitiba', 'images/pet-dog-black-1.png', true, true, true, 'Calmo, ótimo com crianças.', 'available'),
  ('COLOQUE_O_ID_AQUI', 'Mia', 'cat', 'Siamês', 1, 'small', 'Moderada', 'Curitiba', 'images/pet-cat-orange-1.png', true, false, true, 'Curiosa e carinhosa, gosta de colo.', 'available'),
  ('COLOQUE_O_ID_AQUI', 'Luna', 'cat', 'Persa', 3, 'small', 'Baixa', 'Curitiba', 'images/pet-cat-white-1.png', true, true, true, 'Tranquila, prefere ambientes calmos.', 'available'),
  ('COLOQUE_O_ID_AQUI', 'Kiwi', 'bird', 'Calopsita', 1, 'small', 'Alta', 'Curitiba', 'images/pet-bird-colorful-1.png', true, false, false, 'Canta bastante e adora atenção.', 'available'),
  ('COLOQUE_O_ID_AQUI', 'Neve', 'rabbit', 'Angorá', 2, 'small', 'Baixa', 'Curitiba', 'images/pet-rabbit-white-1.png', true, true, false, 'Dócil, gosta de carinho na cabeça.', 'available');
