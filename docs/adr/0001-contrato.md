# Separar front, back y contratos

El front conserva la historia revisada del prototipo. El back gobierna las migraciones y el contrato OpenAPI. Los componentes consumen una copia versionada y sus tipos generados. Los despliegues se pueden revertir independientemente mientras coexistan contratos compatibles.
