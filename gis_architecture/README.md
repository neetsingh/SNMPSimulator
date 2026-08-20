# GIS on AWS Landing Zone 4.5 – Architecture Diagram

This package provides a PowerPoint-ready architecture diagram integrating a GIS application into an AWS Landing Zone 4.5 environment.

## Files

- `architecture.svg` — Editable vector source (2560x1440, 16:9)
- `architecture.png` — High-resolution raster export for presentations
- `README.md` — Component and data-flow reference

## Architecture Summary

### 1) AWS LZ4.5 Foundation Layer
- **Workload Account**: Hosts the GIS VPC and all app/data services.
- **Shared Services Account**: CloudFront, Route 53, and shared API services.
- **Security & Logging Account**: CloudWatch, GuardDuty, CloudTrail, Security Hub.
- **Log Archive Account**: Centralized long-term, immutable log retention.
- **Transit Gateway Hub**: Routed inter-account connectivity.
- **On-Premises Connectivity**: Trusted VPN/Direct Connect integration.

### 2) GIS Workload Architecture (Workload Account)

#### Internet & Access Layer (Public Subnets)
- Internet Gateway
- Application Load Balancer with AWS WAF
- Route 53 DNS routing

#### Container Orchestration (EKS, Multi-AZ)
- GeoServer container/pods
- GIS API container/pods (REST)
- GIS WebApp container/pods (UI)
- Pod networking + service mesh

#### Data Persistence
- **RDS PostgreSQL (Multi-AZ)** with PostGIS, read replicas, automated backups
- **S3 Geospatial Bucket** for Shapefile/KML/GeoJSON, versioning, VPC endpoint access
- **ElastiCache Redis (Multi-AZ)** for tile and session caching
- **EBS Volumes** for persistent application storage

#### Analytics & Warehouse
- Amazon Redshift for geospatial analytics
- Integrated S3 data flows for warehouse ingestion/exports

#### Container Registry
- Amazon ECR for GeoServer, GIS API, and GIS WebApp images

### 3) Security, Network, and Operations Controls
- Public/private subnet separation
- Security Groups with least-privilege intent
- Private VPC endpoint pattern for AWS service access
- Multi-AZ deployment for HA/DR
- CloudWatch logs/metrics + VPC Flow Logs
- GuardDuty + Security Hub threat/compliance visibility
- CloudTrail audit trails sent to log archive

## Data Flow Reference

1. **Client ingress**: User traffic resolves via Route 53 and enters via CloudFront/ALB.
2. **App processing**: ALB routes requests to EKS-hosted GIS services.
3. **Transactional data**: GIS services read/write geospatial records in RDS PostGIS.
4. **Object data**: GIS services load/store geospatial files in S3 through VPC endpoint paths.
5. **Caching**: Tile/session lookups are accelerated through Redis.
6. **Analytics**: Curated data is exchanged between S3 and Redshift.
7. **Image supply chain**: EKS pulls service images from ECR.
8. **Observability/security**: Logs, metrics, trail, and findings stream to Security & Logging and Log Archive accounts.

## Visual Conventions

- **Blue**: networking/access
- **Orange/Red**: compute/container services
- **Green**: storage
- **Purple**: databases
- **Magenta**: analytics/warehouse
- **Amber**: security/monitoring
- Dashed account boxes indicate AWS account boundaries
- Horizontal lanes represent Multi-AZ deployment
