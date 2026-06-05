UPDATE public.pecas_cadastradas
SET dados_brutos_json = COALESCE(dados_brutos_json, '{}'::jsonb) || jsonb_build_object(
  'faces_layout_json', jsonb_build_object(
    'faces', jsonb_build_array(
      jsonb_build_object('face','0','label','Face 0','tipo_vista','principal','largura_visual',219,'altura_visual',460,'posicao_pdf','principal_esquerda','ordem_visual',1),
      jsonb_build_object('face','1','label','Face 1','tipo_vista','lateral','largura_visual',15, 'altura_visual',460,'posicao_pdf','lateral_esquerda','ordem_visual',2),
      jsonb_build_object('face','2','label','Face 2','tipo_vista','inferior','largura_visual',219,'altura_visual',15, 'posicao_pdf','inferior','ordem_visual',6),
      jsonb_build_object('face','3','label','Face 3','tipo_vista','lateral','largura_visual',15, 'altura_visual',460,'posicao_pdf','lateral_direita','ordem_visual',4),
      jsonb_build_object('face','4','label','Face 4','tipo_vista','superior','largura_visual',219,'altura_visual',15, 'posicao_pdf','superior','ordem_visual',5),
      jsonb_build_object('face','5','label','Face 5','tipo_vista','principal','largura_visual',219,'altura_visual',460,'posicao_pdf','principal_direita','ordem_visual',3)
    )
  )
)
WHERE codigo = 'DIV7823A';