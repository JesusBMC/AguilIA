# Guía de despliegue de AgilIA en AWS con Terraform

Esta guía explica, paso a paso, cómo desplegar AgilIA en una cuenta de AWS desde cualquier equipo, clonando el repositorio. Está pensada para alguien que no es experto en AWS: cada paso dice qué comando ejecutar, qué debería ver y qué hacer si algo falla.

Toda la infraestructura se crea con **Terraform** (reemplaza la plantilla de CloudFormation anterior, que ya no existe). No se usa CloudFormation en ningún paso.

Convenciones:

- Cada comando aparece dos veces: un bloque **PowerShell** (Windows) y un bloque **bash** (Linux, macOS o Git Bash). Use solo el de su sistema.
- Ejecute **todos** los comandos desde la carpeta raíz del repositorio clonado (`AguilIA`), salvo que el paso diga otra cosa.
- Lo marcado como **por confirmar** no se pudo verificar al escribir esta guía (por ejemplo, etiquetas exactas de la consola de AWS o precios). Compruébelo en el enlace indicado.
- Nada de esta guía se ejecutó todavía contra una cuenta real de AWS. El código se validó sin conexión a AWS (ver la sección 19). El primer despliegue es la prueba completa: siga las pruebas de humo de la sección 12.

## Índice

1. [Qué se despliega y cuánto cuesta](#1-qué-se-despliega-y-cuánto-cuesta)
2. [Requisitos previos](#2-requisitos-previos)
3. [Clonar el repositorio](#3-clonar-el-repositorio)
4. [Instalar dependencias](#4-instalar-dependencias)
5. [Ejecutar las pruebas](#5-ejecutar-las-pruebas)
6. [Construir las Lambdas](#6-construir-las-lambdas)
7. [Bootstrap del estado remoto](#7-bootstrap-del-estado-remoto)
8. [Desplegar el entorno dev](#8-desplegar-el-entorno-dev)
9. [Habilitar el modelo de Bedrock](#9-habilitar-el-modelo-de-bedrock)
10. [Crear el primer usuario de Cognito](#10-crear-el-primer-usuario-de-cognito)
11. [Abrir la aplicación](#11-abrir-la-aplicación)
12. [Prueba de humo](#12-prueba-de-humo)
13. [Actualizar después de git pull](#13-actualizar-después-de-git-pull)
14. [Rollback](#14-rollback)
15. [Destrucción total](#15-destrucción-total)
16. [Solución de problemas](#16-solución-de-problemas)
17. [Costos estimados](#17-costos-estimados)
18. [Notas de seguridad](#18-notas-de-seguridad)
19. [Limitaciones conocidas](#19-limitaciones-conocidas)

---

## 1. Qué se despliega y cuánto cuesta

Todo se crea en la región **us-east-2 (Ohio)**. El despliegue tiene dos partes:

- **Bootstrap** (`infra/terraform/bootstrap/`), una sola vez por cuenta: un bucket S3 privado que guarda el estado de Terraform y un presupuesto de **AWS Budgets** de USD 100 al mes que envía correos al superar USD 20, 50 y 80.
- **Entorno dev** (`infra/terraform/envs/dev/`):
  - La aplicación web (SPA) en S3, publicada con **CloudFront** en una URL `https://<algo>.cloudfront.net`.
  - El inicio de sesión con **Amazon Cognito**. Solo un administrador puede crear usuarios.
  - Una **API** (API Gateway + Lambda `agilia-api-dev`) que exige sesión en todas las rutas salvo `/health`.
  - Un **worker** (Lambda `agilia-worker-dev`) que procesa cada documento desde una cola SQS con Textract, Comprehend y **Bedrock (Claude Haiku 4.5)**.
  - S3 y DynamoDB para documentos, borradores, trazabilidad y hallazgos. Alarmas de CloudWatch, X-Ray y CloudTrail.

El diagrama y la descripción de cada pieza están en [terraform-arquitectura.md](terraform-arquitectura.md).

**Costo:** con poco uso (1 a 3 personas, unos 100 documentos al mes), las partidas que se pudieron verificar suman entre USD 0,50 y USD 1,50 al mes. A eso se suma **Bedrock**, que se cobra por tokens procesados y cuyo precio está **por confirmar**, más algunas partidas pequeñas también por confirmar. Las partidas caras (OpenSearch, NAT Gateway, ElastiCache) están apagadas u omitidas. El detalle y las fuentes están en la [sección 17](#17-costos-estimados).

## 2. Requisitos previos

Necesita estas herramientas en el equipo desde el que va a desplegar. Después de instalar cada una, **cierre y vuelva a abrir la terminal** para que se actualice el PATH.

### 2.1 git

Comprobar:

PowerShell:

```powershell
git --version
```

bash:

```bash
git --version
```

Salida esperada: `git version 2.x.x` (cualquier versión reciente sirve). Si no está instalado: Windows `winget install --id Git.Git -e`; macOS `xcode-select --install`; Linux, el gestor de paquetes (`sudo apt install git`).

### 2.2 bun 1.4.4 o superior

bun ejecuta las pruebas y construye las Lambdas. No se necesita Node.js.

Comprobar:

PowerShell:

```powershell
bun --version
```

bash:

```bash
bun --version
```

Salida esperada: `1.4.4` o un número mayor. Si no está instalado (instrucciones oficiales en <https://bun.sh/docs/installation>):

PowerShell:

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

bash:

```bash
curl -fsSL https://bun.sh/install | bash
```

### 2.3 Terraform 1.10 o superior (se recomienda 1.11 o más reciente)

El estado remoto usa el bloqueo nativo de S3 (`use_lockfile`). Esa función apareció en Terraform 1.10 y es estable desde 1.11, según el changelog de HashiCorp (versión exacta del changelog **por confirmar**). El código exige `>= 1.10.0, < 2.0.0`. El código se validó con la 1.17.1.

Comprobar:

PowerShell:

```powershell
terraform version
```

bash:

```bash
terraform version
```

Salida esperada: `Terraform v1.1x.x` en la primera línea (por ejemplo `Terraform v1.17.1`), seguida de `on windows_amd64`, `on linux_amd64` o `on darwin_arm64`.

Si no está instalado (instrucciones oficiales en <https://developer.hashicorp.com/terraform/install>; la versión que instale cada gestor de paquetes está **por confirmar**, compruébela con `terraform version`):

PowerShell:

```powershell
winget install --id Hashicorp.Terraform -e
```

bash:

```bash
# macOS (Homebrew)
brew tap hashicorp/tap
brew install hashicorp/tap/terraform
# Linux: siga la sección "Linux" de https://developer.hashicorp.com/terraform/install
# (repositorio apt/yum de HashiCorp o el zip oficial).
```

Alternativa en cualquier sistema: descargue el zip oficial desde <https://releases.hashicorp.com/terraform/>, descomprímalo y ponga `terraform` (o `terraform.exe`) en una carpeta del PATH.

### 2.4 AWS CLI v2

Comprobar:

PowerShell:

```powershell
aws --version
```

bash:

```bash
aws --version
```

Salida esperada: empieza por `aws-cli/2.` (por ejemplo `aws-cli/2.x.x Python/3.x Windows/10 ...`). Si muestra `aws-cli/1.`, instale la v2. Instrucciones oficiales: <https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html>. En Windows también sirve `winget install --id Amazon.AWSCLI -e`.

### 2.5 Credenciales de AWS con el perfil `agilia`

Terraform y la AWS CLI necesitan credenciales de un usuario o rol con permisos amplios en la cuenta (por ejemplo `AdministratorAccess`). Terraform crea roles IAM, buckets y servicios, así que los permisos de solo lectura no alcanzan. Ver la [sección 18](#18-notas-de-seguridad).

Si el equipo ya tiene un perfil configurado para esta cuenta, use ese nombre en lugar de `agilia` en todos los comandos. Si no, elija una de estas dos opciones.

**Opción A: claves de acceso de un usuario IAM.** Pida al administrador de la cuenta un *Access key ID* y un *Secret access key*. No los guarde en el repositorio.

PowerShell:

```powershell
aws configure --profile agilia
```

bash:

```bash
aws configure --profile agilia
```

El comando pregunta 4 valores: la clave de acceso, la clave secreta, la región (escriba `us-east-2`) y el formato de salida (escriba `json`).

**Opción B: IAM Identity Center (SSO)**, si su organización lo usa. Pida la *SSO start URL* al administrador.

PowerShell:

```powershell
aws configure sso --profile agilia
aws sso login --profile agilia
```

bash:

```bash
aws configure sso --profile agilia
aws sso login --profile agilia
```

Con SSO la sesión caduca. Cuando vea `ExpiredToken`, vuelva a ejecutar `aws sso login --profile agilia`.

**Active el perfil y la región en la terminal.** Estas variables solo duran mientras la terminal está abierta. Repita este paso cada vez que abra una terminal nueva.

PowerShell:

```powershell
$env:AWS_PROFILE = "agilia"
$env:AWS_REGION = "us-east-2"
$env:AWS_DEFAULT_REGION = "us-east-2"
```

bash:

```bash
export AWS_PROFILE=agilia
export AWS_REGION=us-east-2
export AWS_DEFAULT_REGION=us-east-2
```

**Compruebe que las credenciales funcionan:**

PowerShell:

```powershell
aws sts get-caller-identity
```

bash:

```bash
aws sts get-caller-identity
```

Salida esperada (con sus propios valores):

```json
{
    "UserId": "AIDAEJEMPLOEJEMPLO123",
    "Account": "123456789012",
    "Arn": "arn:aws:iam::123456789012:user/su-usuario"
}
```

- `UserId`: identificador interno del usuario o de la sesión del rol.
- `Account`: el número de 12 dígitos de la cuenta de AWS. Confirme que es **la cuenta donde quiere desplegar**. Aparece en los nombres de los buckets.
- `Arn`: quién es usted para AWS. Con SSO verá algo como `arn:aws:sts::123456789012:assumed-role/AWSReservedSSO_.../su-correo`.

Si sale un error, vaya a la [sección 16](#16-solución-de-problemas).

## 3. Clonar el repositorio

PowerShell:

```powershell
git clone https://github.com/JesusBMC/AguilIA.git
cd AguilIA
```

bash:

```bash
git clone https://github.com/JesusBMC/AguilIA.git
cd AguilIA
```

Salida esperada: `Cloning into 'AguilIA'...` y luego el regreso al prompt sin errores. A partir de aquí, todos los comandos se ejecutan dentro de `AguilIA`.

## 4. Instalar dependencias

PowerShell:

```powershell
bun install
```

bash:

```bash
bun install
```

Salida esperada: una lista de paquetes y una última línea como `NN packages installed [X.XXs]`. Usa `bun.lock`, así que instala las mismas versiones con las que se probó el código.

## 5. Ejecutar las pruebas

Antes de tocar AWS, confirme que el código funciona en su equipo.

PowerShell:

```powershell
bunx tsc --noEmit
bun test
```

bash:

```bash
bunx tsc --noEmit
bun test
```

Salida esperada:

- `bunx tsc --noEmit` no imprime nada y termina sin error (la revisión de tipos pasó).
- `bun test` termina con un resumen como `NN pass` y **`0 fail`**. Si aparece algún `fail`, no continúe: el problema es del código o del equipo, no de AWS.

## 6. Construir las Lambdas

Terraform empaqueta las dos Lambdas desde la carpeta `dist/lambda/`, que se genera con este paso. Si lo omite, el plan de Terraform falla (ver la [sección 16](#16-solución-de-problemas)).

PowerShell:

```powershell
bun run build:lambda
bun run verify:lambda
```

bash:

```bash
bun run build:lambda
bun run verify:lambda
```

Salida esperada:

- `build:lambda` imprime una línea por Lambda con la ruta y el tamaño, por ejemplo `[build-lambda] api: .../dist/lambda/api/index.mjs (1585.2 KB)` y `[build-lambda] worker: .../dist/lambda/worker/index.mjs (1347.4 KB)`. Los tamaños pueden variar un poco.
- `verify:lambda` importa los dos paquetes con credenciales falsas (no llama a AWS) e invoca `GET /health`. Salida esperada:

```text
[verify-lambda] api: GET /health -> 200 {"status":"ok","auth":"cognito"}
[verify-lambda] worker: handler exportado
[verify-lambda] OK
```

La carpeta `dist/` está en `.gitignore`: no se sube a git.

## 7. Bootstrap del estado remoto

Este paso se hace **una sola vez por cuenta de AWS**. Crea:

- El bucket S3 `agilia-tfstate-<ID_DE_CUENTA>-us-east-2`, donde se guarda el estado de Terraform del entorno dev. Es privado, cifrado, versionado y está protegido contra borrado accidental (`prevent_destroy`).
- El presupuesto mensual `agilia-monthly-budget` de AWS Budgets.
- El archivo `infra/terraform/envs/dev/backend.hcl`, que le dice al entorno dev dónde está su estado. Se genera en UTF-8 desde Terraform. No lo cree con `>` en PowerShell 5.1: esa redirección escribe UTF-16 y Terraform no puede leerlo.

### 7.1 Configurar las variables

PowerShell:

```powershell
Copy-Item infra/terraform/bootstrap/terraform.tfvars.example infra/terraform/bootstrap/terraform.tfvars
notepad infra/terraform/bootstrap/terraform.tfvars
```

bash:

```bash
cp infra/terraform/bootstrap/terraform.tfvars.example infra/terraform/bootstrap/terraform.tfvars
nano infra/terraform/bootstrap/terraform.tfvars
```

Cambie `budget_alert_email = "su-correo@ejemplo.com"` por el correo que debe recibir las alertas de costo. Es la única variable obligatoria. Las demás líneas están comentadas y muestran los valores por defecto (`budget_limit_usd = 100`, `budget_thresholds_usd = [20, 50, 80]`, `aws_region = "us-east-2"`). Guarde y cierre. El archivo `terraform.tfvars` está en `.gitignore`.

### 7.2 Inicializar, revisar y aplicar

PowerShell:

```powershell
terraform -chdir=infra/terraform/bootstrap init
terraform -chdir=infra/terraform/bootstrap plan
terraform -chdir=infra/terraform/bootstrap apply
```

bash:

```bash
terraform -chdir=infra/terraform/bootstrap init
terraform -chdir=infra/terraform/bootstrap plan
terraform -chdir=infra/terraform/bootstrap apply
```

Qué esperar:

- `init` descarga los proveedores fijados en `.terraform.lock.hcl` y termina con `Terraform has been successfully initialized!`.
- `plan` muestra lo que se va a crear y termina con una línea como `Plan: 9 to add, 0 to change, 0 to destroy.` (9 recursos: el bucket y sus 6 configuraciones, el archivo `backend.hcl` y el presupuesto).
- `apply` vuelve a mostrar el plan y pregunta `Enter a value:`. Escriba `yes` y pulse Enter. Termina con `Apply complete! Resources: 9 added, 0 changed, 0 destroyed.` y estas salidas:
  - `state_bucket_name`: el nombre del bucket de estado.
  - `backend_config_files`: la ruta del `backend.hcl` generado para `dev`.
  - `backend_hcl`: el contenido de ese archivo.
  - `budget_name`: `agilia-monthly-budget`.

Compruebe que el archivo quedó creado:

PowerShell:

```powershell
Get-Content infra/terraform/envs/dev/backend.hcl
```

bash:

```bash
cat infra/terraform/envs/dev/backend.hcl
```

Debe ver 3 líneas `bucket = "agilia-tfstate-..."`, `key = "agilia/dev/terraform.tfstate"` y `region = "us-east-2"`, más 2 comentarios.

Notas importantes:

- **Correos de Budgets:** llegan al correo configurado sin confirmación previa. AWS Budgets actualiza los costos unas pocas veces al día, no en tiempo real. El presupuesto excluye créditos y reembolsos (`include_credit = false`) para que las alertas se disparen aunque la cuenta tenga créditos promocionales.
- **Guarde el estado del bootstrap.** El bootstrap guarda su estado en el archivo local `infra/terraform/bootstrap/terraform.tfstate`. No se sube a git (está en `.gitignore`) y solo existe en este equipo. Haga una copia en un lugar seguro y privado. Sin ese archivo, para volver a administrar el bucket o el presupuesto hay que importarlos (ver la [sección 16](#16-solución-de-problemas)).

PowerShell:

```powershell
Copy-Item infra/terraform/bootstrap/terraform.tfstate "$HOME\Documents\agilia-bootstrap.tfstate.backup"
```

bash:

```bash
cp infra/terraform/bootstrap/terraform.tfstate ~/agilia-bootstrap.tfstate.backup
```

## 8. Desplegar el entorno dev

### 8.1 Configurar las variables

PowerShell:

```powershell
Copy-Item infra/terraform/envs/dev/terraform.tfvars.example infra/terraform/envs/dev/terraform.tfvars
notepad infra/terraform/envs/dev/terraform.tfvars
```

bash:

```bash
cp infra/terraform/envs/dev/terraform.tfvars.example infra/terraform/envs/dev/terraform.tfvars
nano infra/terraform/envs/dev/terraform.tfvars
```

Revise al menos:

- `alert_email = "su-correo@ejemplo.com"`: el correo que recibe las alarmas de CloudWatch. Después del despliegue, AWS envía un correo de confirmación de suscripción de SNS (asunto **por confirmar**, suele decir "Subscription Confirmation"). Ábralo y confirme; si no lo hace, las alarmas no llegan. Deje `""` si no quiere alarmas por correo.
- `bedrock_model_id`: por defecto `us.anthropic.claude-haiku-4-5-20251001-v1:0` (perfil de inferencia geográfico de EE. UU. para Claude Haiku 4.5). Déjelo así salvo que la [sección 9](#9-habilitar-el-modelo-de-bedrock) le indique otro.

Las demás variables tienen valores por defecto pensados para bajo costo (por ejemplo `enable_opensearch = false`). Están explicadas dentro del archivo.

### 8.2 Inicializar con el estado remoto

Requisitos: haber hecho la [sección 6](#6-construir-las-lambdas) (Lambdas construidas) y la [sección 7](#7-bootstrap-del-estado-remoto) (existe `backend.hcl`).

PowerShell:

```powershell
terraform -chdir=infra/terraform/envs/dev init -backend-config=backend.hcl
```

bash:

```bash
terraform -chdir=infra/terraform/envs/dev init -backend-config=backend.hcl
```

Salida esperada: `Successfully configured the backend "s3"!` y luego `Terraform has been successfully initialized!`.

### 8.3 Planear y aplicar

PowerShell:

```powershell
terraform -chdir=infra/terraform/envs/dev plan -out=tfplan
terraform -chdir=infra/terraform/envs/dev apply tfplan
```

bash:

```bash
terraform -chdir=infra/terraform/envs/dev plan -out=tfplan
terraform -chdir=infra/terraform/envs/dev apply tfplan
```

Qué esperar:

- `plan` lista los recursos (`+ create`) y termina con una línea como `Plan: 83 to add, 0 to change, 0 to destroy.` Con los valores por defecto son **alrededor de 83 recursos**. Esa cifra se contó en el código; la exacta es la que muestre su plan. Revise que diga `0 to destroy`. El plan se guarda en `infra/terraform/envs/dev/tfplan` (en `.gitignore`).
- `apply tfplan` aplica exactamente ese plan, sin volver a preguntar. Tarda varios minutos: la distribución de CloudFront suele tardar entre 5 y 15 minutos (**por confirmar**) y es lo más lento. Termina con `Apply complete! Resources: NN added, 0 changed, 0 destroyed.` y la lista de salidas.

Si el `apply` falla a medias, no borre nada: corrija la causa (ver la [sección 16](#16-solución-de-problemas)) y repita `plan -out=tfplan` y `apply tfplan`. Terraform retoma desde donde quedó.

### 8.4 Ver las salidas

PowerShell:

```powershell
terraform -chdir=infra/terraform/envs/dev output
```

bash:

```bash
terraform -chdir=infra/terraform/envs/dev output
```

Para leer una sola salida sin comillas use `output -raw <nombre>`, como en las secciones siguientes. Qué significa cada una:

| Salida | Qué es |
|---|---|
| `aws_region` | Región del entorno (`us-east-2`). |
| `frontend_url` | **La URL de la aplicación** (`https://<id>.cloudfront.net`). Es la que se abre en el navegador. |
| `api_url` | URL directa de API Gateway (stage `dev`, sin barra final). Sirve para pruebas; la SPA usa la API a través de `frontend_url`. |
| `cloudfront_distribution_id` | ID de la distribución de CloudFront (para invalidar la caché). |
| `cognito_user_pool_id` | ID del user pool de Cognito (para crear usuarios). |
| `cognito_user_pool_client_id` | ID del cliente de la SPA en Cognito (para obtener tokens en las pruebas). |
| `cognito_hosted_ui_domain` | Dominio de la página de inicio de sesión de Cognito. |
| `documents_bucket_name` | Bucket S3 de documentos y borradores. |
| `frontend_bucket_name` | Bucket S3 con los archivos de la SPA. |
| `audit_bucket_name` | Bucket de CloudTrail (`null` si `enable_cloudtrail = false`). |
| `traceability_table_name` | Tabla DynamoDB de trazabilidad (`agilia-traceability-dev`). |
| `findings_table_name` | Tabla DynamoDB de hallazgos (`agilia-findings-dev`). |
| `processing_queue_url` | URL de la cola SQS de procesamiento. |
| `dlq_url` | URL de la cola de mensajes fallidos (DLQ). |
| `event_bus_name` | Bus de EventBridge (`agilia-events-dev`). |
| `api_function_name` | Lambda de la API (`agilia-api-dev`). |
| `worker_function_name` | Lambda del worker (`agilia-worker-dev`). |
| `opensearch_endpoint` | Endpoint de OpenSearch (`null` si `enable_opensearch = false`). |
| `bedrock_model_id` | Perfil de inferencia de Bedrock que usan las Lambdas. |

## 9. Habilitar el modelo de Bedrock

El worker usa Claude Haiku 4.5 a través del perfil de inferencia `us.anthropic.claude-haiku-4-5-20251001-v1:0`. Según la documentación de AWS, el ID del modelo base no admite invocación bajo demanda: hay que usar el perfil `us.`. Desde us-east-2, ese perfil puede enrutar las solicitudes a **us-east-1, us-east-2 o us-west-2** ([ficha del modelo](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-4-5.html)).

En las regiones comerciales ya no existe una página de "acceso a modelos": los modelos se habilitan con la primera invocación. Los modelos de Anthropic piden además, la primera vez, un formulario de caso de uso, y la primera llamada la debe hacer alguien con permisos de AWS Marketplace ([acceso a modelos](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html)). Las Lambdas **no** tienen esos permisos a propósito. Por eso la primera invocación la hace usted desde la consola, con el usuario administrador.

Que su cuenta pueda usar el modelo está **por confirmar** hasta que complete estos pasos. Los nombres de los menús de la consola también están **por confirmar**, porque la consola cambia con frecuencia.

1. Inicie sesión en <https://console.aws.amazon.com/> con el usuario administrador y elija la región **US East (Ohio) us-east-2** arriba a la derecha.
2. Busque **Amazon Bedrock** y abra el **catálogo de modelos** (*Model catalog*).
3. Filtre por el proveedor **Anthropic** y abra **Claude Haiku 4.5**.
4. Si aparece un formulario de caso de uso de Anthropic, complételo y envíelo (describa el uso: revisión de documentos de contratación pública). Puede tardar unos minutos en aprobarse.
5. Abra el **playground** (*Chat / Text playground*), elija Claude Haiku 4.5 y envíe un mensaje corto, por ejemplo "Hola". Si responde, el modelo quedó habilitado para la cuenta.

Compruebe el perfil desde la terminal:

PowerShell:

```powershell
aws bedrock list-inference-profiles --region us-east-2 --type-equals SYSTEM_DEFINED --query "inferenceProfileSummaries[?contains(inferenceProfileId,'claude-haiku-4-5')].inferenceProfileId"
aws bedrock get-inference-profile --region us-east-2 --inference-profile-identifier us.anthropic.claude-haiku-4-5-20251001-v1:0
```

bash:

```bash
aws bedrock list-inference-profiles --region us-east-2 --type-equals SYSTEM_DEFINED --query "inferenceProfileSummaries[?contains(inferenceProfileId,'claude-haiku-4-5')].inferenceProfileId"
aws bedrock get-inference-profile --region us-east-2 --inference-profile-identifier us.anthropic.claude-haiku-4-5-20251001-v1:0
```

Salida esperada:

- El primer comando muestra una lista que incluye `"us.anthropic.claude-haiku-4-5-20251001-v1:0"` (puede incluir también perfiles `global.` u otros).
- El segundo muestra un JSON con `"status": "ACTIVE"` y, en `models`, los ARN del modelo en us-east-1, us-east-2 y us-west-2.

**Cambiar de modelo.** Si el ID es distinto en su cuenta, o quiere otro modelo (por ejemplo Claude Sonnet 4.5, `us.anthropic.claude-sonnet-4-5-20250929-v1:0`, más caro), cambie `bedrock_model_id` en `infra/terraform/envs/dev/terraform.tfvars` y vuelva a aplicar. Terraform actualiza las variables de entorno de las Lambdas y el permiso IAM del worker. Si el modelo nuevo enruta a otras regiones, ajuste también `bedrock_destination_regions`.

PowerShell:

```powershell
terraform -chdir=infra/terraform/envs/dev plan -out=tfplan
terraform -chdir=infra/terraform/envs/dev apply tfplan
```

bash:

```bash
terraform -chdir=infra/terraform/envs/dev plan -out=tfplan
terraform -chdir=infra/terraform/envs/dev apply tfplan
```

## 10. Crear el primer usuario de Cognito

Nadie puede registrarse solo: el user pool solo admite usuarios creados por un administrador. Así se protege también el gasto en Bedrock. La contraseña debe tener al menos 12 caracteres, con mayúscula, minúscula, número y símbolo. Para que los comandos de esta guía funcionen, **no use comas (`,`) ni comillas (`"`)** en la contraseña.

La contraseña se lee de forma oculta y no se guarda en ningún archivo. Cambie `usuario@ejemplo.com` por el correo real del usuario.

PowerShell:

```powershell
$pool = terraform -chdir=infra/terraform/envs/dev output -raw cognito_user_pool_id
$email = "usuario@ejemplo.com"
aws cognito-idp admin-create-user --user-pool-id $pool --username $email --user-attributes "Name=email,Value=$email" "Name=email_verified,Value=true" --message-action SUPPRESS
$seguro = Read-Host -AsSecureString "Contraseña del usuario"
$clave = [System.Net.NetworkCredential]::new("", $seguro).Password
aws cognito-idp admin-set-user-password --user-pool-id $pool --username $email --password $clave --permanent
Remove-Variable clave, seguro
aws cognito-idp admin-add-user-to-group --user-pool-id $pool --username $email --group-name BolsaTeam
```

bash:

```bash
POOL=$(terraform -chdir=infra/terraform/envs/dev output -raw cognito_user_pool_id)
EMAIL="usuario@ejemplo.com"
aws cognito-idp admin-create-user --user-pool-id "$POOL" --username "$EMAIL" --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true --message-action SUPPRESS
read -r -s -p "Contraseña del usuario: " CLAVE; echo
aws cognito-idp admin-set-user-password --user-pool-id "$POOL" --username "$EMAIL" --password "$CLAVE" --permanent
unset CLAVE
aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL" --username "$EMAIL" --group-name BolsaTeam
```

Salida esperada:

- `admin-create-user` muestra un JSON con `"User"`, el correo en `Attributes` y `"UserStatus": "FORCE_CHANGE_PASSWORD"`. `--message-action SUPPRESS` evita que Cognito envíe el correo de bienvenida con una contraseña temporal.
- `admin-set-user-password` y `admin-add-user-to-group` no imprimen nada cuando funcionan. Tras el primero, el usuario queda en estado `CONFIRMED` con la contraseña definitiva.

Hay dos grupos: `BolsaTeam` (equipo de la Bolsa que revisa) y `PublicServers` (servidores públicos). Hoy las rutas no distinguen grupos (ver la [sección 19](#19-limitaciones-conocidas)).

## 11. Abrir la aplicación

Terraform ya subió los archivos de `web/` y un `config.js` generado con los datos de Cognito. No hay que publicar nada a mano.

PowerShell:

```powershell
Start-Process (terraform -chdir=infra/terraform/envs/dev output -raw frontend_url)
```

bash:

```bash
URL=$(terraform -chdir=infra/terraform/envs/dev output -raw frontend_url)
xdg-open "$URL" 2>/dev/null || open "$URL"
```

En el navegador:

1. Pulse **Iniciar sesión**. Se abre la página de Cognito. Entre con el correo y la contraseña de la sección 10.
2. Al volver, el aviso superior dice "🔐 Autenticación con Amazon Cognito" y arriba aparece su correo.
3. Cargue un documento, por ejemplo el texto de `samples/estudio_previo_pgn_inconsistencias.txt`.
4. En AWS el procesamiento es **asíncrono**: la pantalla muestra "Procesando en AWS… (puede tardar hasta 1–2 minutos)" y consulta el estado cada 3 segundos. Cuando termina, muestra los datos extraídos, los hallazgos y el borrador, igual que en local.
5. La sesión dura alrededor de 1 hora. Después, vuelva a iniciar sesión.

Los archivos de la SPA se suben con `Cache-Control: no-cache`, así que normalmente los cambios se ven sin hacer nada. Si CloudFront sigue mostrando una versión vieja, invalide la caché:

PowerShell:

```powershell
$dist = terraform -chdir=infra/terraform/envs/dev output -raw cloudfront_distribution_id
aws cloudfront create-invalidation --distribution-id $dist --paths "/*"
```

bash:

```bash
DIST=$(terraform -chdir=infra/terraform/envs/dev output -raw cloudfront_distribution_id)
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*"
```

Salida esperada: un JSON con `"Status": "InProgress"`. La invalidación termina en unos minutos.

## 12. Prueba de humo

Estas pruebas confirman que todo funciona después de cada despliegue. Los bloques bash usan `bun` para leer JSON, así que no necesita `jq`.

### 12.1 Salud y autenticación

PowerShell:

```powershell
$front = terraform -chdir=infra/terraform/envs/dev output -raw frontend_url
$api = terraform -chdir=infra/terraform/envs/dev output -raw api_url
curl.exe -s "$front/health"
curl.exe -s "$api/health"
curl.exe -s -i "$api/search?q=valor"
```

bash:

```bash
FRONT=$(terraform -chdir=infra/terraform/envs/dev output -raw frontend_url)
API=$(terraform -chdir=infra/terraform/envs/dev output -raw api_url)
curl -s "$FRONT/health"; echo
curl -s "$API/health"; echo
curl -s -i "$API/search?q=valor"
```

Salida esperada:

- Las dos primeras: `{"status":"ok","auth":"cognito"}`. La primera pasa por CloudFront y la segunda va directo a API Gateway.
- La tercera, sin token: la primera línea es `HTTP/1.1 401 Unauthorized` (o `HTTP/2 401`) y el cuerpo es `{"message":"Unauthorized"}`. Eso confirma que la API rechaza a quien no inició sesión.

### 12.2 Obtener un token y buscar

Use el usuario creado en la sección 10. El comando pide la contraseña de forma oculta.

PowerShell:

```powershell
$pool = terraform -chdir=infra/terraform/envs/dev output -raw cognito_user_pool_id
$client = terraform -chdir=infra/terraform/envs/dev output -raw cognito_user_pool_client_id
$email = "usuario@ejemplo.com"
$seguro = Read-Host -AsSecureString "Contraseña"
$clave = [System.Net.NetworkCredential]::new("", $seguro).Password
$token = aws cognito-idp admin-initiate-auth --user-pool-id $pool --client-id $client --auth-flow ADMIN_USER_PASSWORD_AUTH --auth-parameters "USERNAME=$email,PASSWORD=$clave" --query AuthenticationResult.IdToken --output text
Remove-Variable clave, seguro
Invoke-RestMethod -Uri "$front/search?q=valor" -Headers @{ Authorization = $token } | ConvertTo-Json -Depth 6
```

bash:

```bash
POOL=$(terraform -chdir=infra/terraform/envs/dev output -raw cognito_user_pool_id)
CLIENT=$(terraform -chdir=infra/terraform/envs/dev output -raw cognito_user_pool_client_id)
EMAIL="usuario@ejemplo.com"
read -r -s -p "Contraseña: " CLAVE; echo
TOKEN=$(aws cognito-idp admin-initiate-auth --user-pool-id "$POOL" --client-id "$CLIENT" --auth-flow ADMIN_USER_PASSWORD_AUTH --auth-parameters USERNAME="$EMAIL",PASSWORD="$CLAVE" --query AuthenticationResult.IdToken --output text)
unset CLAVE
curl -s -H "Authorization: $TOKEN" "$FRONT/search?q=valor"; echo
```

Salida esperada: HTTP 200 con `{"query":"valor","results":[...]}`. Si todavía no ha subido documentos, `results` es una lista vacía `[]`. El token es un texto largo que empieza por `eyJ` y vale alrededor de 1 hora.

### 12.3 Subir un documento y esperar el borrador

PowerShell:

```powershell
$texto = Get-Content -Raw -Encoding UTF8 samples/estudio_previo_pgn_inconsistencias.txt
$cuerpo = @{ filename = "estudio_previo_pgn_inconsistencias.txt"; text = $texto } | ConvertTo-Json -Compress
$r = Invoke-RestMethod -Method Post -Uri "$front/documents/upload" -Headers @{ Authorization = $token } -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($cuerpo))
$r
$i = 0
do {
  Start-Sleep -Seconds 5
  $i++
  $doc = Invoke-RestMethod -Uri "$front/documents/$($r.documentId)" -Headers @{ Authorization = $token }
  "Intento ${i}: $($doc.status)"
} while ($doc.status -notin @("DRAFTED", "ERROR") -and $i -lt 60)
Invoke-RestMethod -Uri "$front/documents/$($r.documentId)/draft" -Headers @{ Authorization = $token } | Select-Object documentId, version
```

bash:

```bash
bun -e 'const fs=require("fs"); const f="samples/estudio_previo_pgn_inconsistencias.txt"; process.stdout.write(JSON.stringify({filename:"estudio_previo_pgn_inconsistencias.txt", text: fs.readFileSync(f,"utf8")}))' > /tmp/agilia-upload.json
curl -s -o /tmp/agilia-resp.json -w "HTTP %{http_code}\n" -X POST "$FRONT/documents/upload" -H "Authorization: $TOKEN" -H "Content-Type: application/json" --data-binary @/tmp/agilia-upload.json
cat /tmp/agilia-resp.json; echo
DOC_ID=$(bun -e 'console.log(JSON.parse(require("fs").readFileSync("/tmp/agilia-resp.json","utf8")).documentId)')
for i in $(seq 1 60); do
  sleep 5
  STATUS=$(curl -s -H "Authorization: $TOKEN" "$FRONT/documents/$DOC_ID" | bun -e 'Bun.stdin.text().then(t => console.log(JSON.parse(t).status))')
  echo "Intento $i: $STATUS"
  if [ "$STATUS" = "DRAFTED" ] || [ "$STATUS" = "ERROR" ]; then break; fi
done
curl -s -o /dev/null -w "Borrador: HTTP %{http_code}\n" -H "Authorization: $TOKEN" "$FRONT/documents/$DOC_ID/draft"
```

Salida esperada:

- La subida responde **202** (en bash verá `HTTP 202`; `Invoke-RestMethod` solo muestra el cuerpo) con `{"documentId":"<uuid>","status":"RECEIVED"}`.
- Las consultas muestran `RECEIVED` mientras el worker procesa el documento y luego **`DRAFTED`**, normalmente en uno o dos minutos. Justo antes del final puede ver `VALIDATED` durante un instante: el worker ya validó y está guardando el borrador. El estado pasa a `DRAFTED` solo cuando el borrador ya está guardado, así que la consulta del borrador no falla con 404.
- El borrador responde 200 (PowerShell muestra el `documentId` y la `version`).
- Si termina en `ERROR` o no avanza, revise los logs del worker ([sección 16](#16-solución-de-problemas)). La causa más común es que Bedrock no esté habilitado (sección 9).

## 13. Actualizar después de git pull

Cuando haya cambios nuevos en el repositorio:

PowerShell:

```powershell
git pull
bun install
bunx tsc --noEmit
bun test
bun run build:lambda
terraform -chdir=infra/terraform/envs/dev init -backend-config=backend.hcl
terraform -chdir=infra/terraform/envs/dev plan -out=tfplan
terraform -chdir=infra/terraform/envs/dev apply tfplan
```

bash:

```bash
git pull
bun install
bunx tsc --noEmit
bun test
bun run build:lambda
terraform -chdir=infra/terraform/envs/dev init -backend-config=backend.hcl
terraform -chdir=infra/terraform/envs/dev plan -out=tfplan
terraform -chdir=infra/terraform/envs/dev apply tfplan
```

Qué pasa:

- Volver a ejecutar `init` es seguro. Es necesario si cambiaron los proveedores o los módulos.
- Si cambió el código, el plan muestra `~ update in-place` en las Lambdas: se publica una versión nueva y el alias `live` pasa a apuntar a ella. Si cambió `web/`, se actualizan los objetos de la SPA.
- Revise siempre la línea `Plan:` antes de aplicar. Si dice `to destroy` y no lo esperaba, **no aplique** y pregunte.
- Después de aplicar, repita la [prueba de humo](#12-prueba-de-humo).

## 14. Rollback

### 14.1 Rollback con git (el recomendado)

Vuelve a desplegar una versión anterior del código y de la infraestructura.

PowerShell:

```powershell
git log --oneline -10
git checkout <commit-o-tag-anterior>
bun install
bun run build:lambda
terraform -chdir=infra/terraform/envs/dev plan -out=tfplan
terraform -chdir=infra/terraform/envs/dev apply tfplan
```

bash:

```bash
git log --oneline -10
git checkout <commit-o-tag-anterior>
bun install
bun run build:lambda
terraform -chdir=infra/terraform/envs/dev plan -out=tfplan
terraform -chdir=infra/terraform/envs/dev apply tfplan
```

Cambie `<commit-o-tag-anterior>` por el identificador de la versión buena (la primera columna de `git log`). Revise el plan: si esa versión tenía otra infraestructura, el plan también la revierte. Repita la prueba de humo. Cuando el problema esté corregido en `main`, vuelva con `git checkout main` y despliegue normalmente (sección 13).

### 14.2 Rollback rápido del alias de Lambda

Sirve para volver en segundos a la versión anterior de una Lambda, sin Terraform. API Gateway y la cola SQS invocan el alias `live`, así que basta con moverlo.

PowerShell:

```powershell
aws lambda list-versions-by-function --function-name agilia-api-dev --query "Versions[].Version"
aws lambda get-alias --function-name agilia-api-dev --name live
aws lambda update-alias --function-name agilia-api-dev --name live --function-version 3
```

bash:

```bash
aws lambda list-versions-by-function --function-name agilia-api-dev --query "Versions[].Version"
aws lambda get-alias --function-name agilia-api-dev --name live
aws lambda update-alias --function-name agilia-api-dev --name live --function-version 3
```

- El primer comando lista las versiones publicadas (por ejemplo `["$LATEST", "1", "2", "3", "4"]`).
- El segundo muestra a cuál apunta hoy `live` (`"FunctionVersion": "4"`).
- El tercero lo mueve a la versión anterior. Cambie `3` por el número que corresponda. Para el worker, repita con `--function-name agilia-worker-dev`.
- Compruebe con `curl` a `/health` (sección 12.1).

**Advertencia:** el próximo `terraform apply` vuelve a apuntar `live` a la última versión publicada. Use el rollback rápido solo como medida temporal y corrija el código en git (o haga el rollback con git de la sección 14.1).

## 15. Destrucción total

Esto **borra todos los datos** (documentos, borradores, trazabilidad, usuarios de Cognito) y no se puede deshacer. Destruya primero el entorno y después el bootstrap, en ese orden: el entorno guarda su estado en el bucket del bootstrap.

### 15.1 Destruir el entorno dev

Los buckets tienen objetos y versiones, así que Terraform no puede borrarlos mientras `force_destroy_buckets = false`. Primero cámbielo a `true` y aplique:

PowerShell:

```powershell
notepad infra/terraform/envs/dev/terraform.tfvars
```

bash:

```bash
nano infra/terraform/envs/dev/terraform.tfvars
```

Añada o cambie la línea `force_destroy_buckets = true`, guarde y aplique:

PowerShell:

```powershell
terraform -chdir=infra/terraform/envs/dev plan -out=tfplan
terraform -chdir=infra/terraform/envs/dev apply tfplan
terraform -chdir=infra/terraform/envs/dev destroy
```

bash:

```bash
terraform -chdir=infra/terraform/envs/dev plan -out=tfplan
terraform -chdir=infra/terraform/envs/dev apply tfplan
terraform -chdir=infra/terraform/envs/dev destroy
```

`destroy` muestra todo lo que va a borrar y pregunta `Enter a value:`. Escriba `yes`. Tarda varios minutos (CloudFront es lo más lento) y termina con `Destroy complete! Resources: NN destroyed.`

Alternativa sin `force_destroy_buckets`: vaciar cada bucket a mano. Ojo: `aws s3 rm --recursive` borra los objetos actuales pero **no las versiones anteriores**, y el bucket de documentos está versionado, así que seguirá sin poder borrarse. En ese caso use el botón **Vaciar** (*Empty*) del bucket en la consola de S3 (etiqueta **por confirmar**), que también borra las versiones.

PowerShell:

```powershell
aws s3 rm "s3://$(terraform -chdir=infra/terraform/envs/dev output -raw frontend_bucket_name)" --recursive
```

bash:

```bash
aws s3 rm "s3://$(terraform -chdir=infra/terraform/envs/dev output -raw frontend_bucket_name)" --recursive
```

### 15.2 Destruir el bootstrap

Hágalo solo si ya no va a desplegar ningún entorno en esta cuenta. Borra el bucket de estado y el presupuesto de AWS Budgets (dejará de recibir alertas de costo).

1. El bucket de estado tiene `prevent_destroy = true` para evitar borrarlo por error. Abra `infra/terraform/bootstrap/main.tf` y, dentro de `resource "aws_s3_bucket" "state"`, cambie `prevent_destroy = true` por `prevent_destroy = false`. Es un cambio local: **no lo suba a git**.
2. Vacíe el bucket `agilia-tfstate-<ID_DE_CUENTA>-us-east-2` con el botón **Vaciar** (*Empty*) de la consola de S3 (etiqueta **por confirmar**). Está versionado, así que `aws s3 rm --recursive` no basta.
3. Destruya y deshaga el cambio local:

PowerShell:

```powershell
terraform -chdir=infra/terraform/bootstrap destroy
git checkout -- infra/terraform/bootstrap/main.tf
```

bash:

```bash
terraform -chdir=infra/terraform/bootstrap destroy
git checkout -- infra/terraform/bootstrap/main.tf
```

Escriba `yes` cuando lo pida. Termina con `Destroy complete! Resources: 9 destroyed.` y también borra el archivo `infra/terraform/envs/dev/backend.hcl`.

## 16. Solución de problemas

| Error o síntoma | Causa probable | Qué hacer |
|---|---|---|
| `ExpiredToken`, `Unable to locate credentials` o `No valid credential sources found` | La sesión SSO caducó, o la terminal no tiene `AWS_PROFILE` | Repita la sección 2.5 (variables) y, con SSO, `aws sso login --profile agilia`. Compruebe con `aws sts get-caller-identity`. |
| `AccessDenied` o `is not authorized to perform` durante `apply` | El usuario o rol no tiene permisos suficientes | Use un usuario con permisos de administrador (sección 2.5) y confirme la cuenta con `aws sts get-caller-identity`. |
| `BucketAlreadyOwnedByYou` o `DuplicateRecordException` en el bootstrap | El bootstrap ya se aplicó en esta cuenta pero se perdió su `terraform.tfstate` | Restaure la copia del estado (sección 7). Si no la tiene, importe el bucket y el presupuesto (comandos abajo) y vuelva a aplicar. |
| `BucketAlreadyExists` en el bootstrap | Otra cuenta ya usa ese nombre (muy raro, el nombre incluye el ID de cuenta) | Cambie `project_name` en `bootstrap/terraform.tfvars` y en `envs/dev/terraform.tfvars`. |
| `backend.hcl` no existe, o `init` pide el nombre del bucket | El bootstrap se aplicó en otro equipo (el archivo no se sube a git), o se borró el archivo | Cópielo desde el ejemplo y ponga su ID de cuenta (comandos abajo). Solo en el equipo que tiene el `terraform.tfstate` del bootstrap puede regenerarlo con `terraform -chdir=infra/terraform/bootstrap apply`; en cualquier otro equipo ese `apply` intenta crear de nuevo el bucket y falla con `BucketAlreadyOwnedByYou`. No lo cree con `>` en PowerShell 5.1 (escribe UTF-16). |
| `Error acquiring the state lock` | Otro `plan`/`apply` está en curso, o uno anterior se interrumpió | Espere a que termine el otro. Si está seguro de que nadie más está ejecutando Terraform, use `force-unlock` con el `ID` que muestra el error (comando abajo). |
| `archive_file` o `could not archive missing directory` / `no such file` en `dist/lambda` (texto exacto **por confirmar**) | No se construyeron las Lambdas | Ejecute `bun run build:lambda` (sección 6) y repita el plan. |
| El documento queda en `ERROR`; en los logs aparece `AccessDeniedException` de Bedrock | El modelo no está habilitado en la cuenta, o falta el formulario de Anthropic | Complete la sección 9 y suba el documento otra vez. |
| `ValidationException` con `on-demand throughput isn't supported` | Se configuró el ID del modelo base en vez del perfil de inferencia | Use el ID con prefijo `us.` en `bedrock_model_id` (sección 9). |
| Cognito muestra `redirect_mismatch` | La URL abierta no coincide exactamente con la registrada (`frontend_url` + `/`) | Abra la aplicación con `frontend_url`. Para otra URL (por ejemplo `http://localhost:8787/`), añádala a `cognito_extra_callback_urls` y aplique. |
| La SPA dice "Sesión expirada o no autorizada" (401) | El token caducó (alrededor de 1 hora) | Pulse **Cerrar sesión** y vuelva a **Iniciar sesión**. |
| CloudFront muestra una versión vieja de la SPA | Caché del navegador o de CloudFront | Recargue con Ctrl+F5. Si sigue igual, invalide la caché (sección 11). |
| El documento no pasa de `RECEIVED` o `VALIDATED`, llega la alarma `AgilIA-DLQMessages-dev` o la Lambda agota el tiempo (`Task timed out`) | Falla el worker (Bedrock, Comprehend, permisos o tiempo de 300 s) | Vea los logs del worker y el número de mensajes en la DLQ (comandos abajo). |
| Nunca llega la alerta del presupuesto | Budgets se actualiza pocas veces al día; o el costo real no superó el umbral | Espere al menos un día. El presupuesto ya excluye créditos (`include_credit = false`). Revise la carpeta de spam y el correo en `budget_alert_email`. |
| No llegan las alarmas de CloudWatch | No se confirmó la suscripción de SNS | Busque el correo de confirmación de AWS Notifications (sección 8.1) y confírmelo. |

Importar el bucket de estado y el presupuesto en el bootstrap (cambie `123456789012` por su ID de cuenta):

PowerShell:

```powershell
terraform -chdir=infra/terraform/bootstrap import aws_s3_bucket.state agilia-tfstate-123456789012-us-east-2
terraform -chdir=infra/terraform/bootstrap import 'aws_budgets_budget.monthly[0]' 123456789012:agilia-monthly-budget
terraform -chdir=infra/terraform/bootstrap apply
```

bash:

```bash
terraform -chdir=infra/terraform/bootstrap import aws_s3_bucket.state agilia-tfstate-123456789012-us-east-2
terraform -chdir=infra/terraform/bootstrap import 'aws_budgets_budget.monthly[0]' 123456789012:agilia-monthly-budget
terraform -chdir=infra/terraform/bootstrap apply
```

Crear `backend.hcl` en un equipo sin el estado del bootstrap. Primero vea su ID de cuenta (el campo `Account`) y copie el ejemplo:

PowerShell:

```powershell
aws sts get-caller-identity
Copy-Item infra/terraform/envs/dev/backend.hcl.example infra/terraform/envs/dev/backend.hcl
notepad infra/terraform/envs/dev/backend.hcl
```

bash:

```bash
aws sts get-caller-identity
cp infra/terraform/envs/dev/backend.hcl.example infra/terraform/envs/dev/backend.hcl
nano infra/terraform/envs/dev/backend.hcl
```

En el editor, cambie `<ID_DE_CUENTA>` por los 12 dígitos de `Account`, guarde (Bloc de notas de Windows 10/11 guarda en UTF-8 por defecto) y siga con `init` (sección 8.2). Las líneas `key` y `region` no cambian.

Liberar un bloqueo de estado (solo si nadie más está ejecutando Terraform; cambie `<LOCK_ID>` por el `ID` del mensaje de error):

PowerShell:

```powershell
terraform -chdir=infra/terraform/envs/dev force-unlock <LOCK_ID>
```

bash:

```bash
terraform -chdir=infra/terraform/envs/dev force-unlock <LOCK_ID>
```

Ver los logs del worker en vivo (Ctrl+C para salir) y contar los mensajes en la DLQ:

PowerShell:

```powershell
aws logs tail /aws/lambda/agilia-worker-dev --follow
aws sqs get-queue-attributes --queue-url (terraform -chdir=infra/terraform/envs/dev output -raw dlq_url) --attribute-names ApproximateNumberOfMessages
```

bash:

```bash
aws logs tail /aws/lambda/agilia-worker-dev --follow
aws sqs get-queue-attributes --queue-url "$(terraform -chdir=infra/terraform/envs/dev output -raw dlq_url)" --attribute-names ApproximateNumberOfMessages
```

Para la API, use `/aws/lambda/agilia-api-dev`. Los logs nunca incluyen el texto de los documentos.

## 17. Costos estimados

Supuestos de uso para el entorno dev: 1 a 3 usuarios, unos **100 documentos al mes** enviados como texto desde la SPA, unas 5.000 solicitudes a la API, menos de 1 GB guardado. Valores mensuales en USD. Los precios dependen de la región; cuando la página de AWS daba el ejemplo para otra región, se indica.

| Servicio | Supuesto de uso | Costo estimado USD/mes | Fuente |
|---|---|---|---|
| Lambda (2 funciones, arm64) | ~100 ejecuciones del worker de 1 GB × ~60 s (~6.000 GB-s) y ~5.000 de la API | 0, dentro de la capa gratuita mensual (1 millón de solicitudes y 400.000 GB-s). Fuera de ella: USD 0,20 por millón de solicitudes; la duración en arm64 está **por confirmar** (la página muestra USD 0,0000166667 por GB-s para x86) | <https://aws.amazon.com/lambda/pricing/> |
| API Gateway REST | ~5.000 llamadas | ~0,02 (USD 3,50 por millón, tarifa de US East Ohio) | <https://aws.amazon.com/api-gateway/pricing/> |
| CloudFront | < 1 GB transferido | **por confirmar** | <https://aws.amazon.com/cloudfront/pricing/> |
| S3 (documentos, SPA, auditoría) | < 1 GB | **por confirmar** (almacenamiento). La transferencia de S3 a CloudFront no se cobra y los primeros 100 GB al mes hacia internet son gratis | <https://aws.amazon.com/s3/pricing/> |
| DynamoDB bajo demanda (2 tablas + PITR) | < 100 MB, miles de lecturas y escrituras | ~0,04 por PITR (USD 0,20 por GB-mes, ejemplo de la página); almacenamiento gratis hasta 25 GB y luego USD 0,25 por GB; solicitudes **por confirmar** | <https://aws.amazon.com/dynamodb/pricing/> |
| SQS (cola + DLQ) | < 1 millón de solicitudes, incluido el sondeo de Lambda (cantidad **por confirmar**) | 0 (1 millón de solicitudes gratis al mes para todos los clientes) | <https://aws.amazon.com/sqs/pricing/> |
| EventBridge (eventos personalizados) | ~400 eventos | ~0 (USD 1,00 por millón) | <https://aws.amazon.com/eventbridge/pricing/> |
| Cognito (plan Lite) | < 10 usuarios activos | 0 (la página indica USD 0,0055 por usuario activo después de 10.000 gratis; aplicación a cuentas nuevas **por confirmar**) | <https://aws.amazon.com/cognito/pricing/> |
| Secrets Manager (`enable_rules_secret`) | 1 secreto | 0,40 | <https://aws.amazon.com/secrets-manager/pricing/> |
| CloudWatch (logs, 4 alarmas, 1 dashboard) | < 1 GB de logs | 0, dentro de la capa gratuita (5 GB de logs, 10 métricas de alarma, 3 dashboards de hasta 50 métricas) | <https://aws.amazon.com/cloudwatch/pricing/> |
| X-Ray (`enable_xray_tracing`) | < 100.000 trazas | 0 (las primeras 100.000 trazas registradas al mes son gratis) | <https://aws.amazon.com/cloudwatch/pricing/> |
| CloudTrail (`enable_cloudtrail`) | 1 trail de eventos de administración | 0 por el trail (la primera copia es gratis); el almacenamiento en S3 se suma a la fila de S3 | <https://aws.amazon.com/cloudtrail/pricing/> |
| SNS (correos de alarmas) | Pocos correos | **por confirmar** | <https://aws.amazon.com/sns/pricing/> |
| AWS Budgets | 1 presupuesto sin acciones | 0 (el monitoreo y las notificaciones no tienen costo) | <https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/> |
| Comprehend | 100 documentos × 2 llamadas × hasta 50 unidades (el texto se recorta a 5.000 bytes) = ~10.000 unidades | 0 dentro de la capa gratuita (50.000 unidades por API al mes, 12 meses); fuera de ella ~1,00 (USD 0,0001 por unidad, ejemplo de la página) | <https://aws.amazon.com/comprehend/pricing/> |
| Textract (AnalyzeDocument con FORMS y TABLES) | 0 páginas: la SPA envía texto y Textract solo se usa si llega un archivo en `contentBase64` | 0. Si se envían PDF: USD 0,05 + USD 0,015 por página (ejemplo de US West Oregon; us-east-2 **por confirmar**) | <https://aws.amazon.com/textract/pricing/> |
| Bedrock, Claude Haiku 4.5 | 100 documentos × 2 llamadas (validación, hasta 4.096 tokens de salida; borrador, hasta 8.192). Hipótesis: ~2 millones de tokens de entrada y ~1,2 millones de salida al mes | **por confirmar**. Fórmula: tokens de entrada × precio de entrada + tokens de salida × precio de salida. Fuentes de terceros citan USD 1 y USD 5 por millón (entrada/salida), lo que daría ~8; el precio oficial y el recargo del perfil geográfico están **por confirmar** | <https://aws.amazon.com/bedrock/pricing/> |
| **Total con los valores por defecto** | | **~0,50 a 1,50 + Bedrock + partidas por confirmar** | |

Componentes opcionales u omitidos, para comparar:

| Servicio | Supuesto de uso | Costo estimado USD/mes | Fuente |
|---|---|---|---|
| OpenSearch gestionado, `t3.small.search`, 1 nodo, 10 GB gp3 (solo con `enable_opensearch = true`) | 730 horas | **por confirmar** (la página no mostró la tarifa de esta instancia; fuentes de terceros citan ~26 más el disco) | <https://aws.amazon.com/opensearch-service/pricing/> |
| OpenSearch Serverless (no se usa) | 2 OCU × 730 horas (mínimo de OCU **por confirmar**) | ~350 (USD 0,24 por OCU-hora, ejemplo de US East N. Virginia) | <https://aws.amazon.com/opensearch-service/pricing/> |
| NAT Gateway (omitido) | 1 NAT × 730 horas | ~32,85 más USD 0,045 por GB procesado (tarifa de US East Ohio) | <https://aws.amazon.com/vpc/pricing/> |
| IP pública IPv4 del NAT (omitida) | 730 horas | **por confirmar** | <https://aws.amazon.com/vpc/pricing/> |
| ElastiCache `cache.t3.micro` (omitido) | 730 horas | **por confirmar** | <https://aws.amazon.com/elasticache/pricing/> |

Créditos: según la página de ElastiCache, las cuentas creadas después del 15 de julio de 2025 reciben USD 100 en créditos y hasta USD 100 más por activar servicios básicos. El presupuesto de la sección 7 cuenta el costo **sin** créditos, para avisar del consumo real. Cuánto crédito tiene su cuenta está **por confirmar** en la consola de facturación.

Contenido de precios parafraseado; verifique en la Calculadora de precios de AWS (https://calculator.aws/).

## 18. Notas de seguridad

**Roles y permisos IAM que se crean:**

- `agilia-api-dev-role` y `agilia-worker-dev-role`: un rol por Lambda, con mínimo privilegio. Por ejemplo, la API solo escribe en `uploads/` y lee `drafts/` del bucket de documentos. Cada rol puede listar solo el prefijo que lee (`drafts/` la API, `uploads/` el worker), para que S3 responda 404 y no 403 cuando falta un archivo. Solo el worker puede invocar Bedrock, y solo sobre el perfil y los modelos configurados. Cada rol solo escribe en su propio grupo de logs. Textract y Comprehend no admiten permisos por recurso, así que esas acciones van sobre `*` (está explicado en `infra/terraform/envs/dev/iam.tf`). Ningún rol puede leer el secreto de reglas, porque ningún código lo usa todavía.
- Cognito, CloudTrail y Budgets no crean roles: CloudTrail escribe con una política del bucket de auditoría limitada a su trail.
- **Riesgo principal:** la persona que despliega necesita permisos de administrador (crea roles IAM). Proteja ese perfil: prefiera SSO con sesiones cortas o, si usa claves de acceso, actívelas con MFA en la cuenta, no las comparta y rótelas.

**OpenSearch con endpoint público (solo si `enable_opensearch = true`).** Evaluación de riesgo de este cambio de red frente a la plantilla anterior, que lo ponía dentro de una VPC:

- El endpoint es alcanzable desde internet, pero cada solicitud debe ir firmada (SigV4) por uno de los 2 roles de las Lambdas. La política de acceso no permite a nadie más.
- El tráfico va por HTTPS con TLS 1.2 como mínimo. Los datos están cifrados en reposo y entre nodos.
- No hay usuario maestro ni contraseña.
- Está apagado por defecto. Riesgo residual: un rol de Lambda comprometido podría leer el índice. La alternativa (VPC privada) exige un NAT Gateway, con su costo fijo mensual (sección 17).

**Sin VPC.** Las Lambdas corren en la red administrada por AWS y solo llaman a endpoints públicos de AWS por TLS. No exponen puertos de entrada: solo se invocan a través de API Gateway (con Cognito) y de SQS.

**Secretos fuera de git.** `.gitignore` excluye `terraform.tfvars`, `backend.hcl`, `*.tfstate*`, `tfplan`, `dist/` y `.env`. Solo se suben los `*.tfvars.example`, sin datos reales. El código no contiene credenciales: Terraform y la CLI usan su perfil de AWS.

**El estado de Terraform contiene datos sensibles** (IDs, ARNs, configuración). El bucket de estado está cifrado (SSE-S3), versionado, sin acceso público y rechaza conexiones sin TLS. El estado del bootstrap queda en su disco: guárdelo en un lugar privado.

**Usuarios.** Solo un administrador crea usuarios (sin registro abierto). Las contraseñas se leen de forma oculta y no se guardan en archivos.

**Registros sin datos personales.** Los logs de ejecución de API Gateway están apagados a propósito (`logging_level = "OFF"`, sin trazas de datos), para no guardar el texto de los documentos en CloudWatch. Los errores se ven en los logs y métricas de las Lambdas, que no registran el contenido de los documentos.

**Dónde se procesan los datos.** Todo se guarda en us-east-2. Bedrock, con el perfil geográfico `us.`, puede procesar la solicitud en **us-east-1, us-east-2 o us-west-2** (todas en EE. UU.), según la [ficha del modelo](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-4-5.html). Si una política de datos exige una sola región, hay que elegir un modelo con perfil o invocación en una sola región (disponibilidad **por confirmar**).

**Brecha conocida: token de sesión y scripts externos.** La SPA guarda el ID token de Cognito en `sessionStorage` del navegador. Además, `web/index.html` carga Tailwind desde `https://cdn.tailwindcss.com`, y su política de seguridad de contenido (CSP) permite `'unsafe-inline'` y `'unsafe-eval'`. Si ese CDN se viera comprometido, o si alguien lograra inyectar un script en la página, ese script podría leer el token y usar la API en nombre del usuario hasta que caduque (alrededor de 1 hora). Para dev se acepta. **Antes de producción:** sirva el CSS de Tailwind ya compilado desde el propio bucket, quite `https://cdn.tailwindcss.com` y `'unsafe-eval'` de la CSP, y mueva a un archivo el bloque `<script>` en línea de `index.html` para poder quitar también `'unsafe-inline'`.

**Otros controles.** Los buckets bloquean el acceso público, fuerzan el propietario del bucket y niegan conexiones sin TLS. Las tablas DynamoDB y las colas SQS están cifradas. CloudFront aplica la política administrada de cabeceras de seguridad. El tema SNS de alertas no usa la clave KMS administrada por AWS, porque CloudWatch no podría publicar en él. Los mensajes de alarma solo llevan metadatos de métricas, nunca contenido de documentos.

## 19. Limitaciones conocidas

- **Validado solo sin conexión.** No se ha aplicado nada en una cuenta real de AWS desde el equipo de desarrollo. Se comprobó con `terraform validate`, las pruebas de bun y `bun run verify:lambda`, que importa los paquetes en bun y no en el runtime Node.js de Lambda. Que funcione en `nodejs24.x` está **por confirmar** hasta el primer despliegue.
- **Proveedores de AWS mínimos.** Quedan puntos marcados `// FUTURE WIRING` en `src/providers/aws/`: por ejemplo, convertir la salida de Textract en campos estructurados o la respuesta de Bedrock en secciones tipadas.
- **Tamaño máximo de carga.** Una Lambda acepta hasta 6 MB por solicitud, así que un archivo grande en `contentBase64` falla con 413. La SPA envía texto.
- **Sesión.** La SPA no renueva el token: hay que volver a iniciar sesión cada hora, aproximadamente. Las rutas no distinguen grupos de Cognito (`BolsaTeam`, `PublicServers`). La tarjeta de usuario de la barra lateral es contenido de ejemplo.
- **Tailwind desde un CDN.** La SPA carga Tailwind desde `cdn.tailwindcss.com` con una CSP que permite `'unsafe-inline'` y `'unsafe-eval'`, mientras el token de sesión está en `sessionStorage`. Es una brecha de seguridad conocida (ver la sección 18) que hay que cerrar antes de producción.
- **Búsqueda sin OpenSearch.** Con `enable_opensearch = false`, cada búsqueda recorre toda la tabla de hallazgos. Sirve para un MVP; el costo crece con los datos.
- **OpenSearch público con IAM** cuando se activa (ver la sección 18).
- **Restos de la plantilla anterior.** Las carpetas `.kiro/` y `aidlc-docs/` todavía mencionan la plantilla de CloudFormation eliminada. Quedaron fuera del alcance de este cambio y no afectan al despliegue.
