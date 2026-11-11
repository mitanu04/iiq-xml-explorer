import * as vscode from 'vscode';
import { XmlDocumentModel, parseXml } from './parser/xmlParser';

/**
 * Parses each document at most once per version, so the tree view, outline and
 * hover provider share the same result.
 */
export class DocumentCache {
  private readonly cache = new Map<string, { version: number; model: XmlDocumentModel }>();

  get(document: vscode.TextDocument): XmlDocumentModel {
    const key = document.uri.toString();
    const hit = this.cache.get(key);
    if (hit && hit.version === document.version) {
      return hit.model;
    }
    const model = parseXml(document.getText());
    this.cache.set(key, { version: document.version, model });
    return model;
  }

  forget(document: vscode.TextDocument): void {
    this.cache.delete(document.uri.toString());
  }
}

export function isXmlDocument(document: vscode.TextDocument | undefined): boolean {
  if (!document) { return false; }
  return document.languageId === 'xml' || document.fileName.toLowerCase().endsWith('.xml');
}
