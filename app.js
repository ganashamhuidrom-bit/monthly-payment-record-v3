import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import PDFDocument from 'pdfkit';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend', 'dist')));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/payment-management')
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.log('❌ MongoDB error:', err));

// ==================== SCHEMAS ====================
const customerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String },
  phone: { type: String, required: true, unique: true },
  address: { street: String, city: String, state: String, pincode: String },
  totalOutstanding: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const paymentSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  amount: { type: Number, required: true },
  paymentDate: { type: Date, required: true },
  paymentMonth: { type: String, required: true },
  receiptNumber: { type: String, unique: true, required: true },
  paymentMethod: { type: String, default: 'cash' },
  notes: { type: String },
  createdAt: { type: Date, default: Date.now }
});

const Customer = mongoose.model('Customer', customerSchema);
const Payment = mongoose.model('Payment', paymentSchema);

// ==================== HELPERS ====================
const generateReceiptNumber = async () => {
  const lastPayment = await Payment.findOne().sort({ createdAt: -1 });
  const lastNumber = lastPayment ? parseInt(lastPayment.receiptNumber.split('-')[1]) : 0;
  return `REC-${String(lastNumber + 1).padStart(6, '0')}`;
};

// ==================== CUSTOMER ROUTES ====================
app.get('/api/customers', async (req, res) => {
  try {
    const { search } = req.query;
    let query = {};
    if (search) {
      query = {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { phone: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ]
      };
    }
    const customers = await Customer.find(query).sort({ createdAt: -1 });
    res.json(customers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/customers/:id', async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Not found' });
    res.json(customer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/customers', async (req, res) => {
  try {
    const customer = new Customer(req.body);
    const saved = await customer.save();
    res.status(201).json(saved);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/customers/:id', async (req, res) => {
  try {
    const customer = await Customer.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!customer) return res.status(404).json({ error: 'Not found' });
    res.json(customer);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/customers/:id', async (req, res) => {
  try {
    await Customer.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== PAYMENT ROUTES ====================
app.get('/api/payments', async (req, res) => {
  try {
    const payments = await Payment.find().populate('customerId').sort({ createdAt: -1 });
    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/payments/customer/:customerId', async (req, res) => {
  try {
    const payments = await Payment.find({ customerId: req.params.customerId }).sort({ paymentDate: -1 });
    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/payments', async (req, res) => {
  try {
    const receiptNumber = await generateReceiptNumber();
    const payment = new Payment({ ...req.body, receiptNumber });
    const saved = await payment.save();
    await Customer.findByIdAndUpdate(req.body.customerId, { $inc: { totalOutstanding: req.body.amount } });
    res.status(201).json(saved);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ==================== RECEIPT ROUTES ====================
app.get('/api/receipts/:paymentId', async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.paymentId).populate('customerId');
    if (!payment) return res.status(404).json({ error: 'Not found' });

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const filename = `receipt-${payment.receiptNumber}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    doc.pipe(res);
    doc.fontSize(24).font('Helvetica-Bold').text('PAYMENT RECEIPT', { align: 'center' });
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(0.5);
    
    doc.fontSize(11).font('Helvetica-Bold').text('RECEIPT DETAILS');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Receipt: ${payment.receiptNumber}`);
    doc.text(`Date: ${new Date(payment.paymentDate).toLocaleDateString()}`);
    doc.text(`Month: ${payment.paymentMonth}`);
    doc.moveDown(0.5);
    
    doc.fontSize(11).font('Helvetica-Bold').text('CUSTOMER');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Name: ${payment.customerId.name}`);
    doc.text(`Phone: ${payment.customerId.phone}`);
    if (payment.customerId.email) doc.text(`Email: ${payment.customerId.email}`);
    doc.moveDown(0.5);
    
    doc.fontSize(11).font('Helvetica-Bold').text('PAYMENT');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Amount: ₹${payment.amount}`);
    doc.text(`Method: ${payment.paymentMethod}`);
    if (payment.notes) doc.text(`Notes: ${payment.notes}`);
    
    doc.end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== SERVE FRONTEND ====================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});