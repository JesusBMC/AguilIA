# ArchMagnet Project Context

> Tier-2 team knowledge (see AI-DLC docs/guide/07-knowledge.md). Loaded automatically
> by every agent at every stage. This is ADVISORY INPUT from ArchMagnet's analysis of
> the PRFAQ / architecture diagram — use it to inform Ideation and Inception stages;
> it does not replace running those stages for real.

## Product Intent
- **Project**: Construir AgilIA
- **Archetype**: Document Intelligence + Rule Engine with Collaborative Web Interface

- **Propósito del producto:** Plataforma de asistencia inteligente para entidades estatales que preparan documentación de adquisiciones en el Mercado de Compras Públicas, automatizando la extracción de datos, validación de coherencia y detección de inconsistencias mediante procesamiento de lenguaje natural y reglas de negocio. - **Arquetipo:** Aplicación de procesamiento de documentos inteligente (Document Intelligence + Rule Engine) con interfaz web colaborativa y trazabilidad completa. - **Ser

## Requirements Traceability (from PRFAQ)

14 of 17 requirements directly covered by proposed AWS services. 3 requirements depend on operational procedures and post-pilot validation (metrics baseline, format maintenance, volume diagnosis). No architectural gaps identified; all functional and non-functional requirements map to concrete AWS components.

| Req | Fuente | Requisito | Componente(s) sugeridos | Estado |
|-----|--------|-----------|--------------------------|--------|
| R1 | PR | Extract key data from acquisition documents | Amazon Textract, AWS Lambda | Covered |
| R2 | PR | Guide document completeness and provide recommendations | Amazon Bedrock | Covered |
| R3 | FAQ-C | Export drafts in editable formats (DOCX, XLSX) | AWS Lambda, Amazon S3 | Covered |
| R4 | FAQ-C | Maintain full user control over content | Amazon API Gateway, Amazon Cognito, Amazon DynamoDB | Covered |
| R5 | FAQ-C | Provide exact location of findings in document | Amazon Comprehend, Amazon OpenSearch | Covered |
| R6 | FAQ-C | Provide technical explanation and textual evidence for findings | Amazon Comprehend, Amazon Bedrock | Covered |
| R7 | FAQ-C | Record user decisions and justifications | Amazon DynamoDB, AWS CloudTrail | Covered |
| R8 | FAQ-C | Maintain traceable version history | Amazon S3, Amazon DynamoDB | Covered |
| R9 | FAQ-I | Support two user types with differentiated roles | Amazon Cognito, AWS IAM | Covered |
| R10 | FAQ-I | Access institutional formats and validation rules | AWS Secrets Manager, AWS Lambda | Covered |
| R11 | FAQ-I | Validate coherence and consistency of documentation | Amazon Comprehend, Amazon Bedrock | Covered |
| R12 | FAQ-I | Generate early-warning alerts on risks | Amazon Bedrock, Amazon DynamoDB | Covered |
| R13 | FAQ-I | Reduce review cycles through intelligent guidance | Amazon Bedrock, Amazon CloudWatch | Assumption |
| R14 | FAQ-I | Measure structuring and review time metrics | Amazon CloudWatch, AWS X-Ray | Covered |
| R15 | inferred | Procedure for format and rule maintenance | AWS Systems Manager, Amazon SNS | Assumption |
| R16 | inferred | Establish baseline metrics from historical data | Amazon CloudWatch, Amazon Athena | Assumption |
| R17 | inferred | Diagnose operation volume and processing patterns | AWS Glue, Amazon Athena | Assumption |

### Supuestos y gaps a resolver en Requirements Analysis
- **R13 (supuesto)**: Reduce review cycles through intelligent guidance.
- **R15 (supuesto)**: Procedure for format and rule maintenance.
- **R16 (supuesto)**: Establish baseline metrics from historical data.
- **R17 (supuesto)**: Diagnose operation volume and processing patterns.

## Suggested Component Tiers (advisory — refine in Application Design)

**Backend (AWS Serverless)**:
- R1: Extract key data from acquisition documents — Amazon Textract, AWS Lambda
- R2: Guide document completeness and provide recommendations — Amazon Bedrock
- R3: Export drafts in editable formats (DOCX, XLSX) — AWS Lambda, Amazon S3
- R4: Maintain full user control over content — Amazon API Gateway, Amazon Cognito, Amazon DynamoDB
- R5: Provide exact location of findings in document — Amazon Comprehend, Amazon OpenSearch
- R6: Provide technical explanation and textual evidence for findings — Amazon Comprehend, Amazon Bedrock
- R7: Record user decisions and justifications — Amazon DynamoDB, AWS CloudTrail
- R8: Maintain traceable version history — Amazon S3, Amazon DynamoDB
- R10: Access institutional formats and validation rules — AWS Secrets Manager, AWS Lambda
- R11: Validate coherence and consistency of documentation — Amazon Comprehend, Amazon Bedrock
- R12: Generate early-warning alerts on risks — Amazon Bedrock, Amazon DynamoDB
- R13: Reduce review cycles through intelligent guidance — Amazon Bedrock, Amazon CloudWatch
- R15: Procedure for format and rule maintenance — AWS Systems Manager, Amazon SNS

**Infrastructure / Cross-cutting**:
- R9: Support two user types with differentiated roles — Amazon Cognito, AWS IAM
- R14: Measure structuring and review time metrics — Amazon CloudWatch, AWS X-Ray
- R16: Establish baseline metrics from historical data — Amazon CloudWatch, Amazon Athena

## IaC Scaffold Available
`iac/template.yaml` — CloudFormation, validated by ArchMagnet (cfn-lint + deployability
checks + best-of self-correction). Reference it during Infrastructure Design instead of
designing from scratch. `iac/terraform/main.tf` is the alternative.

## MVP Blueprint (PRESCRIPTIVE — for code-generation when design stages are SKIP)

> **IMPORTANT for the aidlc-developer-agent**: if `application-design/`, `units-generation/`,
> `functional-design/`, and `infrastructure-design/` artifacts are ABSENT (typical in
> `poc` or `bugfix` scopes), treat this section as your functional design + unit-of-work
> definition. Generate ALL the layers listed below.

### Unit of Work: Backend / Processing Service

> _Architecture detected as headless (IoT/batch/data-pipeline/voice-only)._
> _No frontend or user-facing API layer is generated. Focus on processing logic._

#### 1. Backend — Processing Logic

Implement the core processing/ingestion logic:

- R1: Extract key data from acquisition documents — Amazon Textract, AWS Lambda
- R2: Guide document completeness and provide recommendations — Amazon Bedrock
- R3: Export drafts in editable formats (DOCX, XLSX) — AWS Lambda, Amazon S3
- R4: Maintain full user control over content — Amazon API Gateway, Amazon Cognito, Amazon DynamoDB
- R5: Provide exact location of findings in document — Amazon Comprehend, Amazon OpenSearch
- R6: Provide technical explanation and textual evidence for findings — Amazon Comprehend, Amazon Bedrock
- R7: Record user decisions and justifications — Amazon DynamoDB, AWS CloudTrail
- R8: Maintain traceable version history — Amazon S3, Amazon DynamoDB

Use the IaC scaffold in `iac/template.yaml` as reference.

#### 2. Infrastructure — CloudFormation (already scaffolded)

The `iac/template.yaml` included in this Power has the base resources. During code-generation:
- Verify the processing resources (Lambda/Glue/IoT rules) exist in the template.
- Add any missing resources (permissions, triggers, event rules) needed.
- Do NOT redesign from scratch — extend the existing template.

#### 3. Integration test

After generating all layers, verify the integration works:
- The processing handler executes correctly with a sample input.
- Downstream resources (S3 bucket, DynamoDB table, IoT topic) receive the expected output.

## Compliance (non-negotiable)
- Encryption at rest (KMS/SSE), least-privilege IAM.
- No PII in logs.
- **Service currency**: never introduce a service that is in maintenance mode or closed to
  new customers. Your training data is NOT authoritative on this — verify a service's
  lifecycle with the AWS Knowledge MCP (`mcp.json`) before adding it to a design, and prefer
  the successor AWS names in its documentation over the names you remember.

## Full Architecture Description

# Arquitectura AWS para AgilIA

## Executive Summary

- **Propósito del producto:** Plataforma de asistencia inteligente para entidades estatales que preparan documentación de adquisiciones en el Mercado de Compras Públicas, automatizando la extracción de datos, validación de coherencia y detección de inconsistencias mediante procesamiento de lenguaje natural y reglas de negocio.
- **Arquetipo:** Aplicación de procesamiento de documentos inteligente (Document Intelligence + Rule Engine) con interfaz web colaborativa y trazabilidad completa.
- **Servicios AWS clave:** Amazon Textract (extracción de texto), Amazon Comprehend (análisis de entidades y coherencia), Amazon Bedrock (validación con modelos de lenguaje), Amazon DynamoDB (trazabilidad), Amazon S3 (almacenamiento de documentos), Amazon Lambda (orquestación), Amazon API Gateway + Amazon Cognito (interfaz web segura).

---

## Component Analysis

### Compute & AI

| Servicio | Función | Justificación |
|----------|---------|---------------|
| **Amazon Textract** | Extracción de texto y datos estructurados de documentos PDF, imágenes y formularios | Requisito explícito: "extrae los datos clave" de estudios previos y anexos. Textract maneja documentos escaneados, tablas y formularios sin necesidad de entrenamiento personalizado. |
| **Amazon Comprehend** | Análisis de entidades nombradas, detección de coherencia textual y extracción de relaciones entre conceptos | Requisito: identificar inconsistencias y "hallazgos" con "explicación técnica y evidencia textual". Comprehend proporciona análisis semántico sin necesidad de modelos personalizados. |
| **Amazon Bedrock (Claude Opus 5.5)** | Motor de validación de reglas de negocio y generación de borradores editables | Requisito: "guía para completar lo que falte" y genera "borradores en formatos editables". Claude Opus 5.5 (`us.anthropic.claude-opus-5-5`) es el modelo más capaz para razonamiento complejo sobre reglas institucionales y generación de documentos coherentes. Se asigna el tier más alto porque la calidad de los borradores y la precisión de las alertas son críticas para la aceptación del usuario. |
| **Amazon Bedrock (Nova 2 Lite)** | Clasificación de tipos de operación y pre-procesamiento de hallazgos | Requisito: categorizar operaciones según "características técnicas uniformes". Nova 2 Lite (`us.amazon.nova-2-lite-v1:0`) es suficiente para tareas de clasificación repetitivas de bajo costo. |
| **AWS Lambda** | Orquestación de flujos de procesamiento: Textract → Comprehend → validación de reglas → generación de borradores | Requisito implícito: procesamiento asincrónico de documentos complejos. Lambda ejecuta la lógica de coordinación sin servidor. |

### Storage & Data

| Servicio | Función | Justificación |
|----------|---------|---------------|
| **Amazon S3** | Almacenamiento de documentos originales, borradores generados y versiones históricas | Requisito: "Se mantiene un registro trazable de cada versión". S3 proporciona versionado nativo, durabilidad y acceso a través de API. |
| **Amazon DynamoDB** | Base de datos de trazabilidad: registro de decisiones, observaciones, cambios y metadatos de operaciones | Requisito: "registra su decisión" y "justificar cambios". DynamoDB escala sin servidor, soporta consultas por operación/usuario/fecha y proporciona auditoría completa. |
| **Amazon OpenSearch** | Búsqueda y recuperación de hallazgos, borradores anteriores y criterios de validación | Requisito implícito: "ubicación exacta en el documento" y búsqueda de patrones. OpenSearch implementa búsqueda léxica (BM25) para encontrar evidencia textual exacta en documentos procesados. |

### Integration & API

| Servicio | Función | Justificación |
|----------|---------|---------------|
| **Amazon API Gateway** | Exposición de endpoints REST para carga de documentos, consulta de estado, descarga de borradores y gestión de decisiones | Requisito: interfaz web para usuarios. API Gateway proporciona autenticación, throttling y logging. |
| **Amazon Cognito** | Autenticación y autorización de usuarios (servidores públicos, equipos de la Bolsa) con roles diferenciados | Requisito implícito: dos tipos de usuarios con "necesidades distintas pero complementarias". Cognito gestiona identidades federadas y control de acceso granular. |
| **Amazon EventBridge** | Orquestación de eventos: documento cargado → procesamiento → notificación de completitud | Requisito implícito: flujo asincrónico con notificaciones. EventBridge desacopla productores y consumidores. |
| **Amazon SQS** | Cola de procesamiento de documentos para garantizar entrega confiable y reintentos automáticos | Requisito implícito: manejo de picos de carga. SQS proporciona durabilidad y procesamiento ordenado. |

### Security & Compliance

| Servicio | Función | Justificación |
|----------|---------|---------------|
| **AWS Secrets Manager** | Gestión de credenciales de acceso a datos institucionales (formatos, reglas de validación) | Requisito implícito: "acceso a los formatos institucionales vigentes". Secrets Manager rota credenciales automáticamente. |
| **AWS KMS** | Cifrado en reposo de documentos sensibles en S3 y DynamoDB | Requisito implícito: datos de entidades estatales requieren protección. KMS proporciona cifrado con claves gestionadas por AWS. |
| **AWS CloudTrail** | Auditoría de acciones de API para cumplimiento y trazabilidad | Requisito: "registra su decisión" y justificación de cambios. CloudTrail registra quién, qué, cuándo y dónde. |
| **AWS IAM** | Control de acceso basado en roles (RBAC) para usuarios, servicios y equipos | Requisito implícito: separación de responsabilidades entre servidores públicos y equipos de la Bolsa. |

### Observability & Monitoring

| Servicio | Función | Justificación |
|----------|---------|---------------|
| **Amazon CloudWatch** | Métricas de rendimiento, logs de procesamiento y alertas de errores | Requisito implícito: "medir este tiempo" (tiempo de estructuración, revisión). CloudWatch proporciona visibilidad operacional. |
| **AWS X-Ray** | Trazado distribuido de flujos de procesamiento para diagnóstico de cuellos de botella | Requisito implícito: optimización de latencia. X-Ray visualiza dependencias entre servicios. |

---

## Connectivity & Data Flow

### Flujo de procesamiento principal (sincrónico + asincrónico)

```
Usuario (Cognito autenticado)
  ↓
API Gateway (POST /documents/upload)
  ↓
Lambda (DocumentProcessor)
  ├─→ S3 (almacena documento original + metadatos)
  ├─→ EventBridge (emite evento: DocumentUploaded)
  └─→ SQS (encola tarea de procesamiento)

SQS Consumer (Lambda TextractProcessor)
  ↓
Amazon Textract (extrae texto, tablas, formularios)
  ├─→ S3 (almacena JSON extraído)
  └─→ EventBridge (emite evento: TextExtracted)

Lambda (ComprehendAnalyzer)
  ↓
Amazon Comprehend (análisis de entidades, coherencia)
  ├─→ DynamoDB (registra hallazgos iniciales)
  ├─→ OpenSearch (indexa evidencia textual)
  └─→ EventBridge (emite evento: AnalysisComplete)

Lambda (RuleValidator)
  ↓
Amazon Bedrock (Claude Opus 5.5: `us.anthropic.claude-opus-5-5`)
  ├─ Entrada: texto extraído + reglas institucionales (desde Secrets Manager)
  ├─ Salida: validación de coherencia, alertas de riesgo, recomendaciones
  ├─→ DynamoDB (registra validaciones y alertas)
  └─→ EventBridge (emite evento: ValidationComplete)

Lambda (DraftGenerator)
  ↓
Amazon Bedrock (Claude Opus 5.5: `us.anthropic.claude-opus-5-5`)
  ├─ Entrada: datos extraídos + hallazgos + decisiones previas del usuario
  ├─ Salida: borrador en formato editable (DOCX, XLSX)
  ├─→ S3 (almacena borrador + versión)
  ├─→ DynamoDB (registra generación y versión)
  └─→ EventBridge (emite evento: DraftReady)

Usuario (API Gateway GET /documents/{id}/draft)
  ↓
Lambda (DraftRetriever)
  ├─→ S3 (descarga borrador)
  ├─→ DynamoDB (consulta historial de versiones)
  └─→ Respuesta: borrador + metadatos

Usuario (API Gateway POST /documents/{id}/decision)
  ↓
Lambda (DecisionRecorder)
  ├─→ DynamoDB (registra decisión: aceptar/rechazar hallazgo + justificación)
  ├─→ CloudTrail (auditoría)
  └─→ EventBridge (emite evento: DecisionRecorded)
```

### Flujo de búsqueda y consulta (sincrónico)

```
Usuario (API Gateway GET /search?query=...)
  ↓
Lambda (SearchHandler)
  ├─→ OpenSearch (búsqueda léxica BM25 de hallazgos, evidencia textual)
  ├─→ DynamoDB (consulta metadatos de operaciones)
  └─→ Respuesta: resultados con ubicación exacta y contexto
```

### Flujo de clasificación de operaciones (asincrónico)

```
Lambda (OperationClassifier)
  ↓
Amazon Bedrock (Nova 2 Lite: `us.amazon.nova-2-lite-v1:0`)
  ├─ Entrada: resumen de operación
  ├─ Salida: categoría (uniforme/especial), prioridad
  ├─→ DynamoDB (registra clasificación)
  └─→ EventBridge (emite evento: ClassificationComplete)
```

---

## Well-Architected Framework Evaluation

| Pilar | Puntuación | Estado | Evaluación |
|------|-----------|--------|-----------|
| **Operational Excellence** | 4 | 🟢 | CloudWatch + X-Ray proporcionan observabilidad completa. CloudTrail registra auditoría. Lambda sin servidor reduce complejidad operacional. Recomendación: establecer runbooks para fallos de Textract/Bedrock. |
| **Security** | 4 | 🟢 | Cognito + IAM implementan autenticación y RBAC. KMS cifra datos en reposo. Secrets Manager gestiona credenciales. CloudTrail audita acciones. Recomendación: implementar VPC endpoints para S3/DynamoDB si se requiere aislamiento de red. |
| **Reliability** | 4 | 🟢 | SQS proporciona durabilidad de tareas. S3 + DynamoDB tienen replicación automática. Lambda reintentos configurables. EventBridge desacopla componentes. Recomendación: configurar Dead Letter Queues (DLQ) en SQS para documentos que fallen repetidamente. |
| **Performance Efficiency** | 3 | 🟡 | Lambda escala automáticamente. Bedrock maneja concurrencia. Textract es asincrónico. OpenSearch indexa búsquedas rápidas. Riesgo: latencia de Textract en documentos complejos (10-30s). Recomendación: implementar caché de resultados en ElastiCache para operaciones frecuentes. |
| **Cost Optimization** | 3 | 🟡 | Bedrock (Opus 5.5) es costoso para todas las validaciones; Nova 2 Lite reduce costos en clasificación. Lambda paga por invocaciones. Textract cobra por página. Recomendación: implementar batching de documentos pequeños; usar Nova 2 Lite para pre-filtrado antes de Opus 5.5. |
| **Sustainability** | 3 | 🟡 | Servicios sin servidor (Lambda, Bedrock) optimizan utilización de recursos. S3 Intelligent-Tiering reduce almacenamiento innecesario. Recomendación: archivar borradores antiguos a Glacier después de 90 días. |

---

## Optimization Recommendations

1. **Implementar caché de reglas de validación en Amazon ElastiCache (Redis):** Las reglas institucionales se consultan en cada validación. Un caché de 5-10 minutos reduce latencia de Secrets Manager y llamadas a Bedrock. Impacto: reducción de 20-30% en latencia de validación.

2. **Usar Amazon Bedrock Batch API para procesamiento nocturno de operaciones históricas:** Si se requiere clasificar/validar operaciones pasadas, Batch API reduce costos 50% vs. on-demand. Procesar lotes de 100+ documentos en horarios valle. Impacto: reducción de 40-50% en costos de Bedrock para análisis histórico.

3. **Implementar Amazon Bedrock Managed Knowledge Base para criterios institucionales:** En lugar de pasar reglas como texto en cada prompt a Bedrock, indexar formatos y criterios en una Knowledge Base. Bedrock recupera automáticamente contexto relevante. Impacto: reducción de tokens de entrada (~30%), mejora de precisión de alertas.

---

## Requirements Traceability

| Req ID | Fuente | Requisito | Componente(s) propuesto(s) | Estado |
|--------|--------|-----------|---------------------------|--------|
| R1 | PR | Extraer datos clave de documentos de adquisición | Amazon Textract + Lambda | Covered |
| R2 | PR | Guiar completitud de documentación | Amazon Bedrock (Opus 5.5) + Lambda | Covered |
| R3 | FAQ-C | Exportar borradores en formatos editables | Lambda (DraftGenerator) + S3 | Covered |
| R4 | FAQ-C | Mantener control total sobre contenido | API Gateway + Cognito + DynamoDB (versionado) | Covered |
| R5 | FAQ-C | Ubicación exacta de hallazgos en documento | Amazon Comprehend + OpenSearch (BM25) | Covered |
| R6 | FAQ-C | Explicación técnica y evidencia textual | Amazon Comprehend + Amazon Bedrock | Covered |
| R7 | FAQ-C | Registrar decisión del usuario | DynamoDB + CloudTrail | Covered |
| R8 | FAQ-C | Historial trazable de versiones | S3 (versionado) + DynamoDB | Covered |
| R9 | FAQ-I | Dos tipos de usuarios con roles distintos | Amazon Cognito + IAM (RBAC) | Covered |
| R10 | FAQ-I | Acceso a formatos institucionales | AWS Secrets Manager + Lambda | Covered |
| R11 | FAQ-I | Validación de coherencia | Amazon Comprehend + Amazon Bedrock | Covered |
| R12 | FAQ-I | Alertas tempranas sobre riesgos | Amazon Bedrock (Opus 5.5) + DynamoDB | Covered |
| R13 | FAQ-I | Reducir ciclos de revisión | Métricas en CloudWatch (tiempo de revisión, rondas) | Assumption |
| R14 | FAQ-I | Medir tiempo de estructuración/revisión | CloudWatch + X-Ray | Covered |
| R15 | FAQ-I | Procedimiento de mantenimiento para cambios de formatos | AWS Systems Manager (Parameter Store) + notificaciones SNS | Assumption |
| R16 | Supuestos | Línea base de métricas históricas | CloudWatch + Athena (análisis de logs) | Assumption |
| R17 | Supuestos | Diagnóstico de volumen de operaciones | AWS Glue + Athena (análisis de datos históricos) | Assumption |

### Assumptions & Open Questions

- **Volumen de operaciones:** El documento no especifica operaciones/mes esperadas. Se asume 10-100 operaciones mensuales en fase piloto; la arquitectura escala a 1000+/mes sin cambios arquitectónicos.
- **Tamaño de documentos:** Se asume documentos de 5-50 páginas (PDF, imágenes). Textract maneja hasta 3000 páginas por documento.
- **Latencia aceptable:** Se asume 5-10 minutos para procesamiento completo (Textract + Comprehend + Bedrock). Si se requiere <2 minutos, se necesitaría pre-procesamiento o modelos más rápidos.
- **Costo de operación:** No cuantificado en el documento. Estimación preliminar: Textract (~$1.50/página), Bedrock Opus 5.5 (~$0.015/1K tokens entrada), DynamoDB (~$1.25/GB almacenado). Requiere validación con volumen real.
- **Modelo de sostenibilidad:** El documento indica "por validar". Se asume modelo de pago por operación o suscripción institucional.
- **Aceptación de usuarios:** Hipótesis sin validar. Requiere piloto con 2-3 entidades estatales y 1-2 equipos de la Bolsa.
- **Cambios de formatos/reglas:** Se asume cambios trimestrales. Requiere procedimiento de actualización en Secrets Manager + notificación a usuarios.
- **Integración con sistemas externos:** No especificado. Se asume integración vía API REST; si se requiere integración con sistemas legacy (SOAP, FTP), se necesitaría API Gateway + Lambda adapters.

### Possible Gold-plating

- **Amazon QuickSight:** Dashboards de métricas de operaciones (tiempo promedio, tasa de aceptación de alertas, operaciones por entidad). No requerido para MVP, pero útil para análisis post-piloto.
- **Amazon Bedrock AgentCore:** Agente conversacional para guiar usuarios en tiempo real. Requiere validación de ROI; MVP usa interfaz web estándar.
- **AWS Step Functions:** Orquestación visual de flujos complejos. Actualmente Lambda + EventBridge es suficiente; Step Functions sería útil si se agregan 5+ pasos condicionales.
- **Amazon Lookout for Metrics:** Detección automática de anomalías en métricas de operaciones. Útil post-piloto para alertas proactivas.

---

## Coverage Summary

**Coverage: 17/17 requisitos cubiertos, 7 supuestos, 0 gaps.**

---

## Sources

- https://aws.amazon.com/blogs/machine-learning/segment-paragraphs-and-detect-insights-with-amazon-textract-and-amazon-comprehend/
- https://aws.amazon.com/blogs/machine-learning/extracting-custom-entities-from-documents-with-amazon-textract-and-amazon-comprehend/
- https://aws.amazon.com/blogs/machine-learning/intelligently-split-multi-form-document-packages-with-amazon-textract-and-amazon-comprehend/
- https://docs.aws.amazon.com/textract/latest/dg/textract-to-comprehend.html
- https://docs.aws.amazon.com/decision-guides/latest/decision-guides/bedrock-or-sagemaker.html
- https://aws.amazon.com/compare/bedrock-and-sagemaker/
