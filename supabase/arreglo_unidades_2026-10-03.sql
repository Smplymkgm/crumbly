-- Pasa a gramos 5 insumos que tenían unidad "kg" pero precio y stock por gramo.
-- Los números no cambian, solo la unidad. Correr una vez en Supabase → SQL Editor.
update materia
set data = jsonb_set(data, '{unidad}', '"g"')
where id in ('mtkfdfgqssd2','mtkfa5gybwgw','mtkez83gsnp7','mtkgcpck3yok','mtki2a2eb138')
  and data->>'unidad' = 'kg';
