-- Seed data for LimpiezaApp (categories + products, prices in MXN cents)

insert into public.categories (id, name, icon, sort_order) values
  ('c0000000-0000-4000-8000-000000000001', 'Ofertas',            'flash-outline',    0),
  ('c0000000-0000-4000-8000-000000000002', 'Frutas y verduras',  'leaf-outline',     1),
  ('c0000000-0000-4000-8000-000000000003', 'Limpieza del hogar', 'sparkles-outline', 2),
  ('c0000000-0000-4000-8000-000000000004', 'Lácteos y huevo',    'nutrition-outline',3),
  ('c0000000-0000-4000-8000-000000000005', 'Bebidas',            'water-outline',    4);

insert into public.products (category_id, name, description, price_cents, unit, image_url, stock) values
  -- Ofertas
  ('c0000000-0000-4000-8000-000000000001', 'Detergente líquido 5L',      'Detergente líquido para ropa, rinde hasta 60 cargas.',              18900, 'botella', null, 40),
  ('c0000000-0000-4000-8000-000000000001', 'Papel higiénico 12 rollos',  'Paquete de 12 rollos, hoja doble.',                                  9900, 'paquete', null, 60),
  ('c0000000-0000-4000-8000-000000000001', 'Aguacate Hass (malla 1kg)',  'Malla de aguacate Hass de primera.',                                 6900, 'kg',      null, 30),
  -- Frutas y verduras
  ('c0000000-0000-4000-8000-000000000002', 'Plátano',                    'Plátano tabasco fresco.',                                            2490, 'kg',      null, 80),
  ('c0000000-0000-4000-8000-000000000002', 'Manzana roja',               'Manzana red delicious.',                                             5490, 'kg',      null, 50),
  ('c0000000-0000-4000-8000-000000000002', 'Jitomate saladet',           'Jitomate saladet fresco del mercado.',                               3290, 'kg',      null, 70),
  ('c0000000-0000-4000-8000-000000000002', 'Limón sin semilla',          'Limón persa jugoso.',                                                3990, 'kg',      null, 60),
  ('c0000000-0000-4000-8000-000000000002', 'Cebolla blanca',             'Cebolla blanca de primera.',                                         2890, 'kg',      null, 60),
  -- Limpieza del hogar
  ('c0000000-0000-4000-8000-000000000003', 'Cloro 1L',                   'Blanqueador desinfectante multiusos.',                               2590, 'botella', null, 90),
  ('c0000000-0000-4000-8000-000000000003', 'Limpiador multiusos 1L',     'Limpiador líquido multiusos aroma lavanda.',                         3490, 'botella', null, 75),
  ('c0000000-0000-4000-8000-000000000003', 'Jabón lavatrastes 750ml',    'Lavatrastes líquido arranca grasa.',                                 4290, 'botella', null, 55),
  ('c0000000-0000-4000-8000-000000000003', 'Fibra esponja (3 piezas)',   'Fibra con esponja para trastes.',                                    2190, 'paquete', null, 100),
  ('c0000000-0000-4000-8000-000000000003', 'Bolsas para basura grandes', 'Rollo con 25 bolsas resistentes 90x120cm.',                          5690, 'rollo',   null, 45),
  -- Lácteos y huevo
  ('c0000000-0000-4000-8000-000000000004', 'Leche entera 1L',            'Leche entera pasteurizada.',                                         2790, 'litro',   null, 120),
  ('c0000000-0000-4000-8000-000000000004', 'Huevo blanco (30 piezas)',   'Cartera de 30 huevos frescos.',                                      8990, 'cartera', null, 40),
  ('c0000000-0000-4000-8000-000000000004', 'Queso panela 400g',          'Queso panela fresco.',                                               7490, 'pieza',   null, 25),
  ('c0000000-0000-4000-8000-000000000004', 'Yogurt natural 1kg',         'Yogurt natural sin azúcar.',                                         5290, 'pieza',   null, 35),
  -- Bebidas
  ('c0000000-0000-4000-8000-000000000005', 'Agua purificada 6L',         'Garrafón chico de agua purificada.',                                 3190, 'garrafa', null, 65),
  ('c0000000-0000-4000-8000-000000000005', 'Jugo de naranja 1L',         'Jugo de naranja 100% exprimido.',                                    4590, 'botella', null, 40),
  ('c0000000-0000-4000-8000-000000000005', 'Refresco de cola 2L',        'Refresco sabor cola familiar.',                                      3890, 'botella', null, 80),
  ('c0000000-0000-4000-8000-000000000005', 'Agua mineral (6 pack)',      'Six de agua mineral en lata.',                                       6890, 'paquete', null, 30);
