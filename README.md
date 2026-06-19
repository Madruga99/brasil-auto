# 🚛 Rastreador de Guincho / Cegonha (trajeto simulado em tempo real)

Sistema de acompanhamento em tempo real para transporte de veículos. O
administrador cria a viagem (coleta → entrega) por um painel; o servidor
simula o caminhão andando ao longo de uma **rota real** (distância e tempo
calculados pelo OSRM/OpenStreetMap) e o cliente acompanha tudo ao vivo por
um **link único**.

## Tecnologias

- **Node.js + Express + Socket.io** — API e tempo real (o servidor é a
  autoridade da simulação; todos os clientes veem a mesma posição).
- **Leaflet + OpenStreetMap** — mapa (sem chave de API).
- **OSRM** (`router.project-osrm.org`) — rota, distância e tempo estimado.
- **Nominatim** — busca de endereços (geocodificação).
- **ViaCEP** — busca por CEP.
- **Overpass API** — busca de comércios por categoria (postos, oficinas…).

> Tudo gratuito, sem cartão de crédito nem chave de API.

## Como rodar

```bash
npm install
npm start
```

Depois abra:

- **Painel admin:** http://localhost:3000/admin.html
- **Cliente:** o link é gerado por viagem, no formato `http://localhost:3000/t/CODIGO`

A senha padrão do admin é `admin123`. Para mudar:

```bash
# Windows PowerShell
$env:ADMIN_PASSWORD = "minhasenha"; npm start
```

## Fluxo de uso

1. Entre no painel admin com a senha.
2. Digite **origem** e **destino** e escolha nas sugestões (geocodificação).
3. Preencha motorista, placa, carro transportado, cliente e a **velocidade
   da simulação** (ex.: 10× = o trajeto roda 10x mais rápido que o tempo real).
4. Clique em **Criar viagem** → será gerado um código e um link.
5. Copie o link (botão 📋) e envie ao cliente.
6. Clique em **▶ Iniciar** — o caminhão começa a se mover. O cliente vê o
   ícone andando, o ETA caindo, a distância restante e a barra de progresso.
7. Você pode **pausar**, **reiniciar**, mudar a **velocidade** ou **excluir**.

## Busca avançada de origem/destino

Em cada campo (origem e destino) você pode buscar de 3 formas:

1. **Por endereço/local** — digite a rua, bairro ou nome do comércio
   (ex.: "Shopping Iguatemi Campinas").
2. **Por CEP** — digite o CEP (ex.: `01310-100`); o sistema resolve o
   endereço pelo ViaCEP e localiza no mapa automaticamente.
3. **Por categoria de comércio** — clique em **⚙ filtros**, escolha a
   categoria (⛽ posto, 🔧 oficina, 🚗 concessionária, 🅿️ estacionamento,
   🛞 borracharia, 🏬 shopping, 🏥 hospital etc.) e informe a **cidade/UF**.
   Lista todos os comércios daquele tipo na região (via Overpass).

Endpoints da API: `GET /api/geocode?q=&city=&uf=`, `GET /api/cep/:cep`,
`GET /api/places?category=&area=` (todos exigem o header `x-admin-key`).

## Estrutura

```
server.js            API REST + Socket.io
src/
  geo.js             distância, rumo e interpolação na rota
  routing.js         OSRM (rota) e Nominatim (endereço)
  store.js           viagens em memória + persistência em data/trips.json
  simulator.js       motor do "tick" que move os caminhões
public/
  admin.html/.js     painel do administrador
  track.html/.js     página de acompanhamento do cliente
  styles.css         estilos
```

## Observações

- O trajeto é **fictício/simulado**: não há GPS real. O caminhão segue a
  rota calculada na velocidade definida na criação da viagem.
- Os serviços públicos do OSRM/Nominatim têm limites de uso. Para produção,
  considere hospedar seu próprio OSRM ou usar uma chave (Mapbox/Google).
- As viagens são salvas em `data/trips.json` e recarregadas ao reiniciar.
