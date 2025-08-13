
'use strict';
const express = require('express');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');
dotenv.config();



const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data.sqlite');
const WHATSAPP_PHONE = (process.env.WHATSAPP_PHONE || '').replace(/\D/g, '');

require('dotenv').config();

console.log('Variáveis de ambiente:', process.env);
console.log('Número WhatsApp:', process.env.WHATSAPP_PHONE);


const db = new sqlite3.Database(DB_PATH);
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    phone TEXT,
    service_id TEXT NOT NULL,
    service_name TEXT NOT NULL,
    date TEXT NOT NULL,        -- DD/MM/YYYY
    start_time TEXT NOT NULL,  -- HH:MM
    end_time TEXT NOT NULL,    -- HH:MM
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Serviços (ajuste como quiser)
const SERVICES = [
  { id: 'brow-design', name: 'Design de Sobrancelhas', duration: 45, price: 70 },
  { id: 'brow-lamination', name: 'Brow Lamination', duration: 60, price: 160 },
  { id: 'lash-lifting', name: 'Lash Lifting', duration: 60, price: 150 },
  { id: 'lash-classic', name: 'Extensão de Cílios (Clássico)', duration: 120, price: 230 },
  { id: 'lash-volume', name: 'Extensão de Cílios (Volume)', duration: 150, price: 280 }
];

// Horário de funcionamento (0=Dom, 6=Sab)
const WORKING_HOURS = {
  0: null,
  1: { start: '09:00', end: '18:00' },
  2: { start: '09:00', end: '18:00' },
  3: { start: '09:00', end: '18:00' },
  4: { start: '09:00', end: '18:00' },
  5: { start: '09:00', end: '18:00' },
  6: { start: '09:00', end: '13:00' }
};
const SLOT_STEP_MIN = 15;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function formatDateBR(dateStr) {
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

function toMinutes(hhmm){ const [h,m] = hhmm.split(':').map(Number); return h*60+m; }
function toHHMM(mins){ const h = String(Math.floor(mins/60)).padStart(2,'0'); const m = String(mins%60).padStart(2,'0'); return `${h}:${m}`; }
function overlaps(aStart,aEnd,bStart,bEnd){ return (aStart < bEnd) && (aEnd > bStart); }
function weekdayOf(dateStr){ const [y,m,d] = dateStr.split('-').map(Number); const dt = new Date(Date.UTC(y,m-1,d)); return dt.getUTCDay(); }
function workingWindow(dateStr){ const wd = weekdayOf(dateStr); const w = WORKING_HOURS[wd]; if(!w) return null; return {start: toMinutes(w.start), end: toMinutes(w.end)}; }

app.get('/api/services', (req,res)=> res.json(SERVICES));

app.get('/api/available-slots', (req,res)=>{
  const date = (req.query.date||'').trim();
  const duration = parseInt(req.query.duration||'0',10);
  if(!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({error:'Data inválida (DD/MM/YYYY).'});
  if(!duration || duration<=0) return res.status(400).json({error:'Duração inválida.'});
  const win = workingWindow(date); if(!win) return res.json([]);
  db.all(`SELECT start_time,end_time FROM bookings WHERE date=? ORDER BY start_time ASC`,[date],(err,rows)=>{
    if(err) return res.status(500).json({error:'Erro ao consultar.'});
    const booked = rows.map(r=>({start: toMinutes(r.start_time), end: toMinutes(r.end_time)}));
    const slots = [];
    for(let t=win.start; t+duration<=win.end; t+=SLOT_STEP_MIN){
      const s=t,e=t+duration;
      if(!booked.some(b=>overlaps(s,e,b.start,b.end))) slots.push(toHHMM(s));
    }
    res.json(slots);
  });
});

app.post('/api/book', (req,res)=>{
  const { customer_name, phone, service_id, date, start_time, notes } = req.body||{};
  if(!customer_name || !service_id || !date || !start_time) return res.status(400).json({error:'Campos obrigatórios ausentes.'});
  const svc = SERVICES.find(s=>s.id===service_id); if(!svc) return res.status(400).json({error:'Serviço inválido.'});
  const win = workingWindow(date); if(!win) return res.status(400).json({error:'Estúdio fechado nesta data.'});
  const startM = toMinutes(start_time); const endM = startM + svc.duration;
  if(startM < win.start || endM > win.end) return res.status(400).json({error:'Fora do expediente.'});
  db.all(`SELECT start_time,end_time FROM bookings WHERE date=?`,[date],(err,rows)=>{
    if(err) return res.status(500).json({error:'Erro ao consultar.'});
    const conflict = rows.some(r=>overlaps(startM,endM,toMinutes(r.start_time),toMinutes(r.end_time)));
    if(conflict) return res.status(409).json({error:'Horário já reservado. Escolha outro.'});
    const stmt = db.prepare(`INSERT INTO bookings (customer_name,phone,service_id,service_name,date,start_time,end_time,notes)
      VALUES (?,?,?,?,?,?,?,?)`);
    stmt.run(customer_name.trim(), (phone||'').trim(), svc.id, svc.name, date, toHHMM(startM), toHHMM(endM), (notes||'').trim(),
      function(err2){
        if(err2) return res.status(500).json({error:'Erro ao salvar.'});
        let wa = null;
        if(WHATSAPP_PHONE){
         const text = `Olá! Nova solicitação de agendamento:%0A%0A` +
        `Cliente: ${encodeURIComponent(customer_name)}%0A` +
        (phone ? `Telefone: ${encodeURIComponent(phone)}%0A` : ``) +
        `Serviço: ${encodeURIComponent(svc.name)}%0A` +
        `Data: ${encodeURIComponent(formatDateBR(date))}%0A` +
        `Horário: ${encodeURIComponent(toHHMM(startM))} - ${encodeURIComponent(toHHMM(endM))}%0A` +
        (notes ? `Obs: ${encodeURIComponent(notes)}%0A` : ``);
        wa = `https://wa.me/${WHATSAPP_PHONE}?text=${text}`;
        }
        res.status(201).json({ bookingId: this.lastID, whatsappLink: wa });
      });
  });
});

// Buscar agendamentos pelo telefone
app.get('/api/bookings', (req, res) => {
  const phone = (req.query.phone || '').trim().replace(/\D/g, '');
  if (!phone) return res.status(400).json({ error: 'Telefone inválido.' });

  db.all(
    `SELECT id, service_name, date, start_time 
     FROM bookings 
     WHERE phone = ? 
     ORDER BY date, start_time`,
    [phone],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Erro ao buscar agendamentos.' });
      res.json(rows);
    }
  );
});

// Cancelar agendamento pelo ID
app.delete('/api/bookings/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'ID inválido.' });

  db.run(`DELETE FROM bookings WHERE id = ?`, [id], function (err) {
    if (err) return res.status(500).json({ error: 'Erro ao cancelar agendamento.' });
    if (this.changes === 0) return res.status(404).json({ error: 'Agendamento não encontrado.' });
    res.json({ success: true });
  });
});


app.get('*', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT, ()=> console.log(`Servidor http://localhost:${PORT}`));
