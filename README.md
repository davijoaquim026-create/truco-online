# Truco Online

Este projeto mantém o jogo original em HTML/JavaScript e adiciona um modo online por salas.

## Rodar no PC
1. Instale o Node.js.
2. Abra o terminal nesta pasta.
3. Rode `npm install`.
4. Rode `npm start`.
5. Abra `http://localhost:3000`.
6. Clique em **JOGAR ONLINE**, crie uma sala e passe o código para o outro jogador.

## Colocar na internet
Publique esta pasta em uma hospedagem que aceite Node.js e mantenha um servidor HTTP/WebSocket ativo.
Depois, os jogadores acessam o endereço público da aplicação.

## Como funciona
- O anfitrião executa a lógica original da partida e a IA.
- O segundo jogador entra com um código de sala.
- O segundo jogador envia apenas suas ações (jogar carta, truco, aceitar/correr/aumentar).
- O servidor retransmite o estado para o convidado com as cartas dos adversários ocultadas.
- A lógica original do jogo fica preservada para o modo contra IA.
