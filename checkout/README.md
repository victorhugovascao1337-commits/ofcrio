# Checkout CarHub (Pix)

Clone visual do checkout, com backend pronto pra plugar sua API de Pix.

## Como rodar

```bash
npm install
npm start
```

Acesse: http://localhost:3000

## Onde plugar a API de Pix

Tudo acontece em **`server.js`**, na rota `POST /api/pix`.

1. Crie conta no provedor (Mercado Pago, Efí, Asaas, PushinPay...).
2. Pegue seu **Access Token / API Key**.
3. Substitua o bloco marcado com `TODO` pela chamada real da API.
4. A rota deve retornar:
   - `qrCode` → imagem base64 do QR Code
   - `copiaECola` → o código "Pix copia e cola"
   - `txid` → id da transação (pra consultar status)

A confirmação automática do pagamento usa a rota `GET /api/pix/status/:txid`
(o front consulta a cada 5s). Plugue a consulta de status do seu provedor lá.

## Segurança

- Nunca coloque o Access Token no front-end (`public/`). Sempre no `server.js`
  ou em variável de ambiente (`process.env.MP_ACCESS_TOKEN`).
- O valor do produto (R$ 59,90) está fixo no front e revalidado no back —
  mantenha a validação do valor no servidor pra ninguém alterar o preço.
