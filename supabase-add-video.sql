-- Adiciona suporte a vídeo dos pets.
-- Reaproveita o bucket "pet-images" (já público e com política de escrita
-- para usuários autenticados), só guardando o vídeo em outra pasta dele.

alter table public.pets add column if not exists video_url text;
