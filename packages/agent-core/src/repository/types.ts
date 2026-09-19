import type {
  Company,
  Contact,
  Campaign,
  Sequence,
  SequenceExecution,
  SequenceLog
} from '@huntara/schema';

export interface LeadRepository {
  getById(id: string, workspaceId: string): Promise<Contact | null>;
  save(lead: Contact): Promise<Contact>;
  findMany(workspaceId: string, filter?: Record<string, any>): Promise<Contact[]>;
  delete(id: string, workspaceId: string): Promise<void>;
}

export interface CompanyRepository {
  getById(id: string, workspaceId: string): Promise<Company | null>;
  save(company: Company): Promise<Company>;
  findMany(workspaceId: string, filter?: Record<string, any>): Promise<Company[]>;
  delete(id: string, workspaceId: string): Promise<void>;
}

export interface ContactRepository {
  getById(id: string, workspaceId: string): Promise<Contact | null>;
  save(contact: Contact): Promise<Contact>;
  findMany(workspaceId: string, filter?: Record<string, any>): Promise<Contact[]>;
  delete(id: string, workspaceId: string): Promise<void>;
}

export interface CampaignRepository {
  getById(id: string, workspaceId: string): Promise<Campaign | null>;
  save(campaign: Campaign): Promise<Campaign>;
  findMany(workspaceId: string, filter?: Record<string, any>): Promise<Campaign[]>;
  delete(id: string, workspaceId: string): Promise<void>;
}

export interface WorkflowRepository {
  getExecutionById(id: string, workspaceId: string): Promise<SequenceExecution | null>;
  saveExecution(execution: SequenceExecution): Promise<SequenceExecution>;
  saveLog(log: SequenceLog): Promise<SequenceLog>;
  findExecutions(workspaceId: string, filter?: Record<string, any>): Promise<SequenceExecution[]>;
  getSequenceById(id: string, workspaceId: string): Promise<Sequence | null>;
}

export interface AgentMemoryRepository {
  getMemory(workspaceId: string, scope: string, key: string): Promise<unknown>;
  saveMemory(workspaceId: string, scope: string, key: string, value: unknown): Promise<void>;
  deleteMemory(workspaceId: string, scope: string, key: string): Promise<void>;
}
