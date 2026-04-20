# 🚀 HealthEnroll Agentic AI - Setup Guide

This guide will walk you through setting up the HealthEnroll project on your local machine for the first time. The application consists of a **Next.js** frontend and a **FastAPI** backend, utilizing **MongoDB** for data persistence.

---

## 📋 Prerequisites

Ensure you have the following installed on your system:
- **Python 3.9+**
- **Node.js 18+** (with npm)
- **MongoDB** (Local Community Edition or MongoDB Atlas connection string)
- **Git**

---

## 🛠️ Step 1: Initial Repository Setup

1. **Clone the repository** (if you haven't already):
   ```bash
   git clone <repository_url>
   cd ProjAccPriv
   ```

2. **Configure Environment Variables**:
   Copy the example environment file and fill in your local details:
   ```bash
   cp .env.example .env
   ```
   *Edit `.env` and ensure `MONGO_URI` points to your MongoDB instance (default: `mongodb://localhost:27017`) and `MONGO_DB_NAME` is set to `health_enroll`.*

---

## 🐍 Step 2: Backend Setup (Python)

1. **Create a Virtual Environment**:
   ```bash
   python -m venv venv
   ```

2. **Activate the Virtual Environment**:
   - **Windows**: `venv\Scripts\activate`
   - **macOS/Linux**: `source venv/bin/activate`

3. **Install Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

---

## ⚛️ Step 3: Frontend Setup (Next.js)

1. **Navigate to the client directory**:
   ```bash
   cd client
   ```

2. **Install Node dependencies**:
   ```bash
   npm install
   ```

3. **Return to the root directory**:
   ```bash
   cd ..
   ```

---

## 📊 Step 4: MongoDB Setup

1. **Start MongoDB**: Ensure your local MongoDB service is running (e.g., via MongoDB Compass or terminal).
2. **Initial Structure**: The application will automatically create the `health_enroll` database and necessary collections (`members`, `batches`) upon first use.

---

## 🏃 Step 5: Running the Application

To run the full platform, you need to start both the backend and frontend servers simultaneously.

### 1. Start the Backend (FastAPI)
Open a terminal in the **root directory** (with `venv` activated):
```bash
uvicorn server.main:app --reload
```
- The backend will be available at: `http://localhost:8000`
- API Documentation (Swagger): `http://localhost:8000/docs`

### 2. Start the Frontend (Next.js)
Open a **new** terminal in the `client` directory:
```bash
npm run dev
```
- The frontend will be available at: `http://localhost:3000`

---

## 🧪 Testing the Workflow

1. Open `http://localhost:3000` in your browser.
2. Go to **Inbound Gateway** (Subscriber Onboarding).
3. Upload an EDI 834 file (you can find samples in `synthetic_data/`).
4. Click **Check Path Integrity** to parse the file into the database.
5. Navigate to the **Integrity Workbench** to review and validate member records.
6. Use **Release Staging** to bundle members into enrollment batches.

---

## 🔍 Troubleshooting

- **MongoDB Connection Error**: Check your `.env` file and verify that the MongoDB service is active.
- **Next.js Missing Modules**: If you see "Module not found", run `npm install` again inside the `client` folder.
- **Python Imports**: Ensure you always run the backend with the virtual environment activated.

---

**Developed for Accenture - ProjAccPriv**  
*Agentic AI Framework for Automated EDI Enrollment Analytics*
