export interface ReservationReceiptData {
  reservationId?: string;
  reservationCode: string;
  customerName: string;
  partySize: number;
  date?: string;
  time?: string;
  startAt?: string;
  endAt?: string;
  status?: string;
  tableNumber?: string | number | null;
  notes?: string | null;
  phone?: string | null;
  email?: string | null;
  restaurantName?: string;
  branch?: {
    name?: string;
    address?: string;
    city?: string;
    phone?: string;
  } | null;
}

export function printReservationReceipt(data: ReservationReceiptData) {
  const code = data.reservationCode || `RES-${(data.reservationId || '').slice(-6).toUpperCase()}`;
  const restaurantName = data.restaurantName || 'Melio Fine Dining';
  const branchName = data.branch?.name || 'Main Branch';
  const branchAddress = [data.branch?.address, data.branch?.city].filter(Boolean).join(', ') || 'Melio Restaurant';
  const branchPhone = data.branch?.phone || '+254 700 000 000';
  
  let formattedDate = data.date || '';
  let formattedTime = data.time || '';
  if (data.startAt) {
    const d = new Date(data.startAt);
    if (!formattedDate) {
      formattedDate = d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }
    if (!formattedTime) {
      formattedTime = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }

  const tableLabel = data.tableNumber ? `Table #${data.tableNumber}` : 'Allocated upon arrival';
  const statusLabel = (data.status || 'CONFIRMED').replace(/_/g, ' ');
  const guestContact = [data.phone, data.email].filter(Boolean).join(' • ') || 'None provided';

  const printWindow = window.open('', '_blank', 'width=540,height=780');
  if (!printWindow) {
    alert('Please allow popups to print your reservation confirmation receipt.');
    return;
  }

  printWindow.document.write(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Reservation Confirmation - ${code}</title>
  <style>
    @page { size: auto; margin: 12mm; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      margin: 0;
      padding: 24px;
      color: #1f2937;
      background: #fdfdfd;
      font-size: 13px;
      line-height: 1.5;
    }
    .ticket {
      max-width: 440px;
      margin: 0 auto;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 18px;
      padding: 30px;
      box-shadow: 0 4px 18px rgba(0,0,0,0.05);
    }
    .header {
      text-align: center;
      border-bottom: 2px dashed #f97316;
      padding-bottom: 20px;
      margin-bottom: 20px;
    }
    .logo-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      background: linear-gradient(135deg, #ea580c 0%, #f97316 100%);
      color: #fff;
      border-radius: 12px;
      font-size: 22px;
      margin-bottom: 8px;
      box-shadow: 0 4px 10px rgba(234, 88, 12, 0.3);
    }
    .restaurant-title {
      font-size: 22px;
      font-weight: 800;
      color: #111827;
      letter-spacing: -0.5px;
      margin: 0;
    }
    .receipt-subtitle {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 2px;
      color: #ea580c;
      margin-top: 4px;
    }
    .ref-box {
      background: #fff7ed;
      border: 1.5px dashed #fdba74;
      border-radius: 12px;
      padding: 12px;
      text-align: center;
      margin-bottom: 22px;
    }
    .ref-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #9a3412;
      font-weight: 700;
    }
    .ref-code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 20px;
      font-weight: 800;
      color: #c2410c;
      letter-spacing: 2px;
      margin-top: 2px;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 20px;
    }
    .info-card {
      background: #f9fafb;
      padding: 10px 14px;
      border-radius: 10px;
      border: 1px solid #f3f4f6;
    }
    .info-label {
      font-size: 10px;
      text-transform: uppercase;
      color: #6b7280;
      font-weight: 700;
      letter-spacing: 0.5px;
    }
    .info-value {
      font-size: 13px;
      font-weight: 700;
      color: #111827;
      margin-top: 2px;
    }
    .details-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }
    .details-table tr {
      border-bottom: 1px solid #f3f4f6;
    }
    .details-table td {
      padding: 8px 0;
    }
    .details-table td:first-child {
      color: #6b7280;
      font-weight: 600;
      width: 40%;
    }
    .details-table td:last-child {
      color: #111827;
      font-weight: 700;
      text-align: right;
    }
    .notes-box {
      background: #fefce8;
      border-left: 3px solid #eab308;
      padding: 10px 12px;
      border-radius: 6px;
      font-size: 11px;
      color: #854d0e;
      margin-bottom: 20px;
    }
    .footer {
      border-top: 1px solid #e5e7eb;
      padding-top: 16px;
      text-align: center;
      font-size: 11px;
      color: #6b7280;
    }
    .print-actions {
      text-align: center;
      margin-top: 20px;
    }
    .btn {
      display: inline-block;
      background: #ea580c;
      color: #fff;
      font-weight: 700;
      padding: 10px 22px;
      border-radius: 10px;
      text-decoration: none;
      border: none;
      cursor: pointer;
      font-size: 13px;
    }
    .btn:hover { background: #c2410c; }
    @media print {
      body { padding: 0; background: #fff; }
      .ticket { border: none; box-shadow: none; padding: 0; max-width: 100%; }
      .print-actions { display: none; }
    }
  </style>
</head>
<body>
  <div class="ticket">
    <div class="header">
      <div class="logo-badge">🍴</div>
      <h1 class="restaurant-title">${restaurantName}</h1>
      <div class="receipt-subtitle">Table Reservation Confirmation</div>
    </div>

    <div class="ref-box">
      <div class="ref-label">Booking Reference</div>
      <div class="ref-code">${code}</div>
    </div>

    <div class="info-grid">
      <div class="info-card">
        <div class="info-label">Reserved Date</div>
        <div class="info-value">${formattedDate}</div>
      </div>
      <div class="info-card">
        <div class="info-label">Seating Time</div>
        <div class="info-value">${formattedTime}</div>
      </div>
      <div class="info-card">
        <div class="info-label">Party Size</div>
        <div class="info-value">${data.partySize} ${data.partySize === 1 ? 'Guest' : 'Guests'}</div>
      </div>
      <div class="info-card">
        <div class="info-label">Table Status</div>
        <div class="info-value" style="color: #ea580c;">${tableLabel}</div>
      </div>
    </div>

    <table class="details-table">
      <tr>
        <td>Primary Guest</td>
        <td>${data.customerName}</td>
      </tr>
      <tr>
        <td>Contact</td>
        <td>${guestContact}</td>
      </tr>
      <tr>
        <td>Venue / Branch</td>
        <td>${branchName}</td>
      </tr>
      <tr>
        <td>Location</td>
        <td>${branchAddress}</td>
      </tr>
      <tr>
        <td>Branch Phone</td>
        <td>${branchPhone}</td>
      </tr>
      <tr>
        <td>Booking Status</td>
        <td><span style="color: #059669; font-weight: 800;">${statusLabel}</span></td>
      </tr>
    </table>

    ${data.notes ? `
    <div class="notes-box">
      <strong>Special Requests / Preferences:</strong><br/>
      ${data.notes}
    </div>
    ` : ''}

    <div class="footer">
      <p style="margin: 0 0 6px 0;"><strong>Arrival Policy:</strong> Please arrive 5–10 minutes prior to your seating time. Reservations are held for 15 minutes past the scheduled time.</p>
      <p style="margin: 0;">We look forward to serving you an exceptional culinary dining experience!</p>
    </div>

    <div class="print-actions">
      <button class="btn" onclick="window.print()">Print or Save as PDF</button>
    </div>
  </div>

  <script>
    window.addEventListener('load', function() {
      setTimeout(function() {
        window.print();
      }, 350);
    });
  </script>
</body>
</html>
  `);
  printWindow.document.close();
}

/**
 * Generates and triggers download of an .ics Calendar event file
 */
export function downloadReservationIcs(data: ReservationReceiptData) {
  const code = data.reservationCode || `RES-${(data.reservationId || '').slice(-6).toUpperCase()}`;
  const restaurantName = data.restaurantName || 'Melio Restaurant';
  const branchName = data.branch?.name || 'Main Branch';
  const location = [branchName, data.branch?.address, data.branch?.city].filter(Boolean).join(', ');

  let startDate: Date;
  if (data.startAt) {
    startDate = new Date(data.startAt);
  } else if (data.date && data.time) {
    startDate = new Date(`${data.date}T${data.time}:00`);
  } else {
    startDate = new Date();
  }

  const endDate = data.endAt ? new Date(data.endAt) : new Date(startDate.getTime() + 90 * 60000);

  const formatIcsDate = (d: Date) =>
    d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Melio RMS//Table Reservation//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:melio-res-${code}@melio.com`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(startDate)}`,
    `DTEND:${formatIcsDate(endDate)}`,
    `SUMMARY:Table Reservation at ${restaurantName} (${data.partySize} Guests)`,
    `DESCRIPTION:Table reservation for ${data.customerName} (${data.partySize} Guests).\\nRef: ${code}\\nVenue: ${branchName}\\n${data.notes ? `Notes: ${data.notes}\\n` : ''}`,
    `LOCATION:${location}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder: Table reservation in 1 hour',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `reservation-${code}.ics`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Downloads a clean text summary of the reservation
 */
export function downloadReservationSummary(data: ReservationReceiptData) {
  const code = data.reservationCode || `RES-${(data.reservationId || '').slice(-6).toUpperCase()}`;
  const lines = [
    '========================================',
    `       ${(data.restaurantName || 'MELIO RESTAURANT').toUpperCase()}       `,
    '   TABLE RESERVATION CONFIRMATION SLIP  ',
    '========================================',
    `Booking Reference: ${code}`,
    `Guest Name:        ${data.customerName}`,
    `Party Size:        ${data.partySize} Guests`,
    `Date:              ${data.date || (data.startAt ? new Date(data.startAt).toLocaleDateString() : 'N/A')}`,
    `Time:              ${data.time || (data.startAt ? new Date(data.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A')}`,
    `Table:             ${data.tableNumber ? `Table #${data.tableNumber}` : 'Allocated upon arrival'}`,
    `Status:            ${(data.status || 'CONFIRMED').toUpperCase()}`,
    `Venue / Branch:    ${data.branch?.name || 'Main Branch'}`,
    `Branch Address:    ${data.branch?.address || 'N/A'}, ${data.branch?.city || ''}`,
    `Branch Phone:      ${data.branch?.phone || 'N/A'}`,
    `Contact:           ${data.phone || ''} ${data.email || ''}`,
    data.notes ? `Special Requests:  ${data.notes}` : '',
    '----------------------------------------',
    'ARRIVAL POLICY:',
    '- Please arrive 5-10 minutes before your reservation.',
    '- Tables are held for up to 15 minutes past reserved time.',
    '========================================',
  ].filter(Boolean).join('\n');

  const blob = new Blob([lines], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `reservation-${code}.txt`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
