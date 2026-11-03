# Instrucciones para el agente que despliega AgilIA en AWS

> Para un agente de IA (o una persona) que, en OTRO equipo ya configurado
> para AWS, debe desplegar AgilIA desde este repositorio. Si eres un agente
> y te piden "desplegar AgilIA en AWS", empieza aquí.

## Qué es este proyecto

AgilIA es un sistema de inteligencia documental para contratación pública a
través de la Bolsa Mercantil de Colombia (BMC). Lee un estudio previo y sus
anexos, llena las 3 plantillas estandarizadas de la Bolsa y genera alertas de
inconsistencia. Nunca inventa datos: si un dato falta, deja el campo vacío,
genera una alerta y pide que se complete. Nada bloquea: toda alerta es color +
recomendación.

- Local (por defecto): corre sin AWS con `AIDLC_PROVIDER=local`.
- AWS: con `AIDLC_PROVIDER=aws`, usa S3, DynamoDB, Textract, Bedrock, etc.

## La guía de despliegue es la fuente de verdad

Todos los pasos reales están en **`docs/despliegue-aws.md`**, con comandos para
PowerShell y para bash. NO improvises comandos: sigue esa guía en orden. La
arquitectura está en `docs/terraform-arquitectura.md`.

Orden resumido (el detalle está en la guía):

1. Verificar requisitos: `git`, `bun`, Terraform >= 1.x, AWS CLI v2, y
   credenciales de AWS válidas (`aws sts get-caller-identity`).
2. `git clone` del repositorio y `bun install`.
3. `bun test` para confirmar que la base está en verde.
4. `bun run build:lambda` para empaquetar las funciones.
5. Bootstrap del estado remoto de Terraform (crea el bucket de estado).
6. `terraform init / plan / apply` en `infra/terraform/envs/dev`.
7. Habilitar el acceso al modelo de Bedrock en la consola.
8. Crear el primer usuario de Cognito.
9. Publicar la interfaz y correr la prueba de humo (health + una llamada
   autenticada).

## Datos fijos del proyecto

- Región AWS: **us-east-2** (Ohio). Es donde está la cuenta con el crédito.
- Cuenta AWS: nueva, con crédito limitado ($100). Cuida el gasto.
- Git remoto: `https://github.com/JesusBMC/AguilIA.git`, rama `main`.
- Identidad para commits (NO cambies `git config` global):
  `git -c user.name="Jesus" -c user.email="jesus.parra@bolsamercantil.com.co" commit ...`
- Runtime: `bun` (no Node). TypeScript ESM.

## Guardas: cuándo DETENERTE y preguntar antes de actuar

- Antes de `terraform apply` por primera vez: muestra el `plan` y confirma.
  Crea recursos que cuestan dinero.
- Antes de habilitar OpenSearch (`enable_opensearch`): está apagado por
  defecto porque es el servicio más caro. No lo enciendas sin autorización.
- Antes de cualquier cambio de IAM, políticas de red o cifrado: explica el
  riesgo y espera aprobación.
- Antes de `terraform destroy`: confirma. Borra todo y vacía los buckets.
- Si una alarma de presupuesto se dispara: avisa, no sigas creando recursos.
- Si un dato marcado "por confirmar" en la guía (precio, id de modelo de
  Bedrock, runtime) no coincide con la realidad: avisa, no lo asumas.

## Límites

- No subas secretos a git. `terraform.tfvars` está en `.gitignore`; usa
  `terraform.tfvars.example` como plantilla.
- No toques `.kiro/` ni `aidlc-docs/` (son del marco de trabajo, no de la app).
- El código de Terraform pasó todas las validaciones sin conexión, pero que
  despliegue de verdad en AWS solo se comprueba en el primer `apply` real.
