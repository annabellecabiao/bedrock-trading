# Azure Deployment Guide — Bedrock Consumer Goods Trading

This guide details how to build, containerize, and deploy the **Bedrock Consumer Goods Trading** website to Microsoft Azure using Docker.

---

## Architecture Overview

- **Frontend & Backend**: Node.js + Express serving the Spanish Wine & Olive Oil catalog, cart, and Admin Portal.
- **Database**: SQLite with persistent volume storage (located in `/app/data/bedrock.db`).
- **Authentication**: JWT role-based access control (`admin` and `viewer`).
- **Containerization**: Multi-stage Alpine Dockerfile.
- **Target Azure Services**:
  - **Azure Container Apps** *(Recommended)*: Modern serverless container hosting, automatic SSL, zero-idle scaling, and cost efficiency.
  - **Azure App Service (Web App for Containers)**: Managed enterprise PaaS container hosting.

---

## 1. Local Testing with Docker

Before deploying to the cloud, you can test the complete stack locally using Docker Compose:

```bash
# Build and run the container
docker compose up --build

# Run in background (detached)
docker compose up -d

# Check container logs
docker compose logs -f

# Stop the container
docker compose down
```

Visit in your browser:
- **Main Website**: [http://localhost:8081](http://localhost:8081) (or `http://localhost:8080` if running standalone)
- **Admin Portal**: [http://localhost:8081/admin.html](http://localhost:8081/admin.html)
- **Health Check**: [http://localhost:8081/health](http://localhost:8081/health)

---

## 2. Default Seed Accounts

When launched for the first time, the database automatically seeds with:

| Account Type | Email | Password | Role |
| :--- | :--- | :--- | :--- |
| **Administrator** | `admin@bedrocktrading.ph` | `AdminPassword123!` | Full control (Catalog, Leads, Orders, Users) |
| **Viewer** | `viewer@bedrocktrading.ph` | `ViewerPassword123!` | Public customer view, cart & order history |

> [!IMPORTANT]
> Change the default passwords in your environment variables before public production deployment.

---

## 3. Option A: Deploy to Azure Container Apps (Recommended)

Azure Container Apps is the most cost-effective and flexible way to run containerized web apps with custom domains and SSL.

### Step 3.1: Login to Azure CLI
```bash
az login
```

### Step 3.2: Create a Resource Group and Azure Container Registry (ACR)
```bash
# Set variables
RESOURCE_GROUP="rg-bedrock-prod"
LOCATION="southeastasia" # or "eastasia"
ACR_NAME="acrbedrocktrading"

# Create Resource Group
az group create --name $RESOURCE_GROUP --location $LOCATION

# Create Azure Container Registry (ACR)
az acr create --resource-group $RESOURCE_GROUP --name $ACR_NAME --sku Basic --admin-enabled true
```

### Step 3.3: Build & Push the Docker Image to ACR
```bash
# Build image directly in ACR (no local docker daemon push needed)
az acr build --registry $ACR_NAME --image bedrock-trading:v1 .
```

### Step 3.4: Create Azure Storage for Persistent Database Volume
Because SQLite stores data in a file (`/app/data/bedrock.db`), mounting an Azure Storage File Share ensures all orders, products, and user accounts persist across container restarts and updates.

```bash
STORAGE_ACCOUNT="sabedrockdata"
FILE_SHARE="bedrock-db-share"

# Create Storage Account
az storage account create --name $STORAGE_ACCOUNT --resource-group $RESOURCE_GROUP --location $LOCATION --sku Standard_LRS

# Get Storage Account Key
STORAGE_KEY=$(az storage account keys list --resource-group $RESOURCE_GROUP --account-name $STORAGE_ACCOUNT --query "[0].value" --output tsv)

# Create File Share
az storage share create --name $FILE_SHARE --account-name $STORAGE_ACCOUNT --account-key $STORAGE_KEY
```

### Step 3.5: Create the Container App Environment and Mount Storage
```bash
ENV_NAME="env-bedrock"
APP_NAME="bedrock-trading-app"

# Create Container Apps Environment
az containerapp env create --name $ENV_NAME --resource-group $RESOURCE_GROUP --location $LOCATION

# Link Azure File Share to the Container Apps Environment
az containerapp env storage set \
  --name $ENV_NAME \
  --resource-group $RESOURCE_GROUP \
  --storage-name bedrockstorage \
  --azure-file-account-name $STORAGE_ACCOUNT \
  --azure-file-account-key $STORAGE_KEY \
  --azure-file-share-name $FILE_SHARE \
  --access-mode ReadWrite
```

### Step 3.6: Deploy the Container App
```bash
# Get ACR credentials
ACR_USERNAME=$(az acr credential show --name $ACR_NAME --query "username" -o tsv)
ACR_PASSWORD=$(az acr credential show --name $ACR_NAME --query "passwords[0].value" -o tsv)

# Create Container App with volume mount and environment variables
az containerapp create \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --environment $ENV_NAME \
  --image "$ACR_NAME.azurecr.io/bedrock-trading:v1" \
  --target-port 8080 \
  --ingress external \
  --registry-server "$ACR_NAME.azurecr.io" \
  --registry-username $ACR_USERNAME \
  --registry-password $ACR_PASSWORD \
  --cpu 0.5 --memory 1.0Gi \
  --env-vars \
    NODE_ENV=production \
    PORT=8080 \
    JWT_SECRET="generate_a_long_random_secret_string_here" \
    ADMIN_EMAIL="admin@bedrocktrading.ph" \
    ADMIN_PASSWORD="YourStrongAdminPasswordHere!" \
  --mount-name bedrockstorage \
  --mount-path /app/data
```

Your app will be live at `https://<APP_NAME>.<ENV_NAME>.<REGION>.azurecontainerapps.io` with automatic HTTPS!

---

## 4. Option B: Deploy to Azure App Service (Linux Web App for Containers)

If your organization prefers standard Azure App Service:

### Step 4.1: Create App Service Plan
```bash
PLAN_NAME="plan-bedrock-prod"
WEBAPP_NAME="bedrock-trading"

az appservice plan create \
  --name $PLAN_NAME \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --is-linux \
  --sku B1
```

### Step 4.2: Create the Web App for Containers
```bash
az webapp create \
  --resource-group $RESOURCE_GROUP \
  --plan $PLAN_NAME \
  --name $WEBAPP_NAME \
  --deployment-container-image-name "$ACR_NAME.azurecr.io/bedrock-trading:v1"
```

### Step 4.3: Configure App Settings and Port
```bash
az webapp config appsettings set \
  --resource-group $RESOURCE_GROUP \
  --name $WEBAPP_NAME \
  --settings \
    WEBSITES_PORT=8080 \
    PORT=8080 \
    NODE_ENV=production \
    JWT_SECRET="generate_a_long_random_secret_string_here" \
    WEBSITES_ENABLE_APP_SERVICE_STORAGE=true
```

---

## 5. Setting Up a Custom Domain (e.g. `bedrocktrading.ph`)

1. In the **Azure Portal**, open your Container App or Web App.
2. Navigate to **Custom domains** in the left navigation sidebar.
3. Click **Add custom domain**.
4. Enter your domain (e.g. `www.bedrocktrading.ph` or `bedrocktrading.ph`).
5. Add the provided `CNAME` and `TXT` validation records to your DNS provider (e.g. Cloudflare, GoDaddy, Namecheap).
6. Click **Validate** and **Add**. Azure will automatically provision a free managed SSL certificate.
