/**
 * ChatStorage - 对话历史持久化存储服务
 * 
 * 功能：
 * 1. 保存和加载会话历史
 * 2. 支持多会话管理
 * 3. 自动总结和知识沉淀
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const Logger = require('../utils/logger');

class ChatStorage {
  constructor() {
    this.storageDir = path.join(os.homedir(), '.openclaw', 'chat-sessions');
    this.summariesDir = path.join(os.homedir(), '.openclaw', 'chat-summaries');
    this.ensureDirectories();
  }

  /**
   * 确保存储目录存在
   */
  ensureDirectories() {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }
      if (!fs.existsSync(this.summariesDir)) {
        fs.mkdirSync(this.summariesDir, { recursive: true });
      }
    } catch (err) {
      Logger.error('Failed to create chat storage directories: ' + err.message);
    }
  }

  /**
   * 获取会话文件路径
   */
  getSessionPath(sessionId) {
    return path.join(this.storageDir, `${sessionId}.json`);
  }

  /**
   * 保存会话
   * @param {string} sessionId - 会话ID
   * @param {Array} messages - 消息列表
   * @param {Object} metadata - 会话元数据（标题、创建时间等）
   */
  saveSession(sessionId, messages, metadata = {}) {
    try {
      const sessionData = {
        id: sessionId,
        messages: messages,
        metadata: {
          ...metadata,
          updatedAt: Date.now(),
          messageCount: messages.length
        }
      };
      
      const filePath = this.getSessionPath(sessionId);
      fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2), 'utf-8');
      Logger.info(`Session saved: ${sessionId}, messages: ${messages.length}`);
      return { success: true };
    } catch (err) {
      Logger.error('Failed to save session: ' + err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * 加载会话（完整加载）
   */
  loadSession(sessionId) {
    try {
      const filePath = this.getSessionPath(sessionId);
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'Session not found' };
      }
      
      const data = fs.readFileSync(filePath, 'utf-8');
      const session = JSON.parse(data);
      return { success: true, session };
    } catch (err) {
      Logger.error('Failed to load session: ' + err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * 分页加载会话消息（用于滚动分页加载更多历史消息）
   * @param {string} sessionId - 会话ID
   * @param {number} offset - 起始偏移量
   * @param {number} limit - 每次加载的消息数量
   */
  loadSessionMessages(sessionId, offset = 0, limit = 50) {
    try {
      const filePath = this.getSessionPath(sessionId);
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'Session not found' };
      }
      
      const data = fs.readFileSync(filePath, 'utf-8');
      const session = JSON.parse(data);
      const allMessages = session.messages || [];
      
      // 分页获取消息
      const messages = allMessages.slice(offset, offset + limit);
      const hasMore = offset + limit < allMessages.length;
      
      return { 
        success: true, 
        session: {
          id: session.id,
          metadata: session.metadata,
          messages,
          totalCount: allMessages.length
        },
        hasMore,
        nextOffset: offset + limit
      };
    } catch (err) {
      Logger.error('Failed to load session messages: ' + err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * 获取最近的会话列表
   */
  listRecentSessions(limit = 20) {
    try {
      if (!fs.existsSync(this.storageDir)) {
        return { success: true, sessions: [] };
      }

      const files = fs.readdirSync(this.storageDir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          const filePath = path.join(this.storageDir, f);
          try {
            const stat = fs.statSync(filePath);
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            return {
              id: data.id || f.replace('.json', ''),
              title: data.metadata?.title || this._generateTitle(data.messages),
              messageCount: data.messages?.length || 0,
              updatedAt: data.metadata?.updatedAt || stat.mtimeMs,
              createdAt: data.metadata?.createdAt || stat.birthtimeMs
            };
          } catch (e) {
            return null;
          }
        })
        .filter(s => s !== null)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit);

      return { success: true, sessions: files };
    } catch (err) {
      Logger.error('Failed to list sessions: ' + err.message);
      return { success: false, error: err.message, sessions: [] };
    }
  }

  /**
   * 从消息生成标题
   */
  _generateTitle(messages) {
    const firstUserMsg = messages?.find(m => m.role === 'user');
    if (firstUserMsg?.content) {
      const title = firstUserMsg.content.substring(0, 50);
      return title.length < firstUserMsg.content.length ? title + '...' : title;
    }
    return '新对话';
  }

  /**
   * 删除会话
   */
  deleteSession(sessionId) {
    try {
      const filePath = this.getSessionPath(sessionId);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return { success: true };
    } catch (err) {
      Logger.error('Failed to delete session: ' + err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * 保存总结
   */
  saveSummary(sessionId, summary, knowledgeItems = []) {
    try {
      const summaryData = {
        sessionId,
        summary,
        knowledgeItems,
        createdAt: Date.now()
      };
      
      const filePath = path.join(this.summariesDir, `${sessionId}-summary.json`);
      fs.writeFileSync(filePath, JSON.stringify(summaryData, null, 2), 'utf-8');
      
      // 同时追加到知识库文件
      if (knowledgeItems.length > 0) {
        this._appendToKnowledgeBase(knowledgeItems);
      }
      
      Logger.info(`Summary saved for session: ${sessionId}`);
      return { success: true };
    } catch (err) {
      Logger.error('Failed to save summary: ' + err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * 追加知识到知识库
   */
  _appendToKnowledgeBase(knowledgeItems) {
    try {
      const kbPath = path.join(this.summariesDir, 'knowledge-base.json');
      let kb = { items: [], updatedAt: Date.now() };
      
      if (fs.existsSync(kbPath)) {
        kb = JSON.parse(fs.readFileSync(kbPath, 'utf-8'));
      }
      
      // 添加新知识项（避免重复）
      const existingIds = new Set(kb.items.map(i => i.id));
      for (const item of knowledgeItems) {
        if (!existingIds.has(item.id)) {
          kb.items.push({
            ...item,
            addedAt: Date.now()
          });
        }
      }
      
      kb.updatedAt = Date.now();
      fs.writeFileSync(kbPath, JSON.stringify(kb, null, 2), 'utf-8');
    } catch (err) {
      Logger.error('Failed to update knowledge base: ' + err.message);
    }
  }

  /**
   * 获取知识库
   */
  getKnowledgeBase() {
    try {
      const kbPath = path.join(this.summariesDir, 'knowledge-base.json');
      if (!fs.existsSync(kbPath)) {
        return { success: true, items: [] };
      }
      
      const kb = JSON.parse(fs.readFileSync(kbPath, 'utf-8'));
      return { success: true, items: kb.items || [] };
    } catch (err) {
      Logger.error('Failed to read knowledge base: ' + err.message);
      return { success: false, error: err.message, items: [] };
    }
  }

  /**
   * 获取会话统计
   */
  getSessionStats(sessionId) {
    try {
      const result = this.loadSession(sessionId);
      if (!result.success) {
        return result;
      }

      const session = result.session;
      const totalChars = session.messages?.reduce((sum, m) => sum + (m.content?.length || 0), 0) || 0;
      const userMessages = session.messages?.filter(m => m.role === 'user').length || 0;
      const assistantMessages = session.messages?.filter(m => m.role === 'assistant').length || 0;

      return {
        success: true,
        stats: {
          messageCount: session.messages?.length || 0,
          userMessages,
          assistantMessages,
          totalChars,
          avgCharsPerMessage: session.messages?.length ? Math.round(totalChars / session.messages.length) : 0
        }
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * 清理过期会话（保留最近N个）
   */
  cleanupOldSessions(keepCount = 100) {
    try {
      const result = this.listRecentSessions(1000);
      if (!result.success) return result;

      const sessions = result.sessions;
      if (sessions.length <= keepCount) {
        return { success: true, deleted: 0 };
      }

      const toDelete = sessions.slice(keepCount);
      let deleted = 0;
      
      for (const session of toDelete) {
        const delResult = this.deleteSession(session.id);
        if (delResult.success) deleted++;
      }

      Logger.info(`Cleaned up ${deleted} old sessions`);
      return { success: true, deleted };
    } catch (err) {
      Logger.error('Failed to cleanup sessions: ' + err.message);
      return { success: false, error: err.message };
    }
  }
}

module.exports = ChatStorage;
