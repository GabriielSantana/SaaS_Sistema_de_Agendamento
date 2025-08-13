const serviceSel = document.getElementById('service');
const dateInput = document.getElementById('date');
const slotsDiv = document.getElementById('slots');
const form = document.getElementById('booking-form');
const resultDiv = document.getElementById('result');
document.getElementById('year').textContent = new Date().getFullYear();

let services = [];
let selectedSlot = null;

function formatDateBR(dateStr) {
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

async function loadServices() {
  const res = await fetch('/api/services');
  services = await res.json();
  serviceSel.innerHTML = '<option value="">Selecione...</option>' + services.map(s =>
    `<option value="${s.id}" data-duration="${s.duration}">${s.name} — ${s.duration}min — R$ ${s.price}</option>`
  ).join('');
}

function getDuration() {
  const opt = serviceSel.selectedOptions[0];
  return opt ? parseInt(opt.dataset.duration || '0', 10) : 0;
}

function clearSlots(message = 'Selecione o serviço e a data') {
  slotsDiv.innerHTML = message;
  selectedSlot = null;
}

async function loadSlots() {
  const date = dateInput.value;
  const duration = getDuration();
  if (!date || !duration) { clearSlots(); return; }
  slotsDiv.textContent = 'Carregando horários...';
  const url = `/api/available-slots?date=${date}&duration=${duration}`;
  const res = await fetch(url);
  const slots = await res.json();
  if (!Array.isArray(slots) || slots.length === 0) {
    clearSlots('Nenhum horário disponível nesta data.');
    return;
  }
  slotsDiv.innerHTML = '';
  slots.forEach(time => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'slot-btn';
    btn.textContent = time;
    btn.addEventListener('click', () => {
      Array.from(document.querySelectorAll('.slot-btn')).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedSlot = time;
    });
    slotsDiv.appendChild(btn);
  });
}

serviceSel.addEventListener('change', loadSlots);
dateInput.addEventListener('change', loadSlots);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const serviceId = serviceSel.value;
  const date = dateInput.value;
  const name = document.getElementById('name').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const notes = document.getElementById('notes').value.trim();
  if (!serviceId || !date || !selectedSlot || !name) {
    return showResult('Preencha todos os campos e selecione um horário.', true);
  }
  const payload = { customer_name: name, phone, service_id: serviceId, date, start_time: selectedSlot, notes };
  const res = await fetch('/api/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data && data.error ? data.error : 'Erro ao salvar.';
    return showResult(msg, true);
  }
  let html = `<strong>Agendamento criado!</strong><br>` +
    `${name} — ${services.find(s => s.id === serviceId).name}<br>` +
    `Data: ${formatDateBR(date)} | Horário: ${selectedSlot}`;
  if (data.whatsappLink) {
    html += `<br><br><a id="wa-link" href="${data.whatsappLink}" target="_blank" rel="noopener">Enviar solicitação no WhatsApp</a>`;
  } else {
    html += `<br><br>Configure o WhatsApp no arquivo <code>.env</code> para habilitar o envio.`;
  }
  showResult(html, false);
  await loadSlots();
});

function showResult(msg, isError) {
  resultDiv.hidden = false;
  resultDiv.innerHTML = msg;
  resultDiv.style.borderColor = isError ? '#ef4444' : '#e5e7eb';
  if (!isError) {
    setTimeout(() => {
      resultDiv.hidden = true;
      resultDiv.innerHTML = '';
    }, 10000); // esconde depois de 10 segundos
  }
}

loadServices();

const today = new Date().toISOString().slice(0, 10);
dateInput.min = today;
