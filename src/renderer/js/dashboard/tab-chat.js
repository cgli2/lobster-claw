/* eslint-disable no-unused-vars, no-undef */
const TabChat = {
  _messages: [],
  _isStreaming: false,
  _currentSessionId: null,
  _agents: [],
  _skills: [],
  _selectedAgent: null,
  _thinkingLevel: 'medium',
  _useLocalMode: false,
  _streamUnsubscribe: null,
  _imUnsubscribe: null,
  _sessions: [],
  _showSessionList: false,
  _autoSaveTimer: null,
  _lastSummaryTime: 0,
  _summaryThreshold: 20000, // 字符数阈值，超过此值触发总结建议
  _currentThinkingContent: '', // 当前流式思考内容
  _isThinking: false,         // 是否处于思考阶段
  _contextMenu: null,         // 右键菜单 DOM 元素
  _waitingTimer: null,        // 等待阶段计时器
  _waitingStartTime: 0,       // 等待开始时间戳
  _connectingWarnTimer: null, // 连接超时预警计时器（30s 后提示用户）
  _waitingPhase: 'connecting', // 'connecting' | 'thinking' | 'generating'
  _attachments: [],           // 待发附件列表 [{name, content, size}]
  // 滚动分页相关
  _hasMoreMessages: true,    // 是否还有更多历史消息
  _isLoadingMore: false,     // 是否正在加载更多
  _messageLoadLimit: 50,     // 每次加载的消息数量
  _loadedMessageCount: 0,    // 已加载的消息数量
  _totalMessageCount: 0,    // 会话总消息数

  async render(container) {
    // 尝试加载最近的会话
    await this._loadRecentSession();
    
    // 如果没有加载到会话，创建新会话
    if (!this._currentSessionId) {
      this._currentSessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    }
    
    container.innerHTML = `
      <div class="chat-container">
        <div class="chat-header">
          <h2>智能对话</h2>
          <div class="chat-settings">
            <label class="chat-setting-item" title="使用本地模式（不需要 Gateway）">
              <input type="checkbox" id="chat-local-mode" ${this._useLocalMode ? 'checked' : ''}>
              <span>本地模式</span>
            </label>
            <select id="chat-thinking" class="select" style="width: 100px;">
              <option value="off" ${this._thinkingLevel === 'off' ? 'selected' : ''}>无思考</option>
              <option value="minimal" ${this._thinkingLevel === 'minimal' ? 'selected' : ''}>最少</option>
              <option value="low" ${this._thinkingLevel === 'low' ? 'selected' : ''}>低</option>
              <option value="medium" ${this._thinkingLevel === 'medium' ? 'selected' : ''}>中</option>
              <option value="high" ${this._thinkingLevel === 'high' ? 'selected' : ''}>高</option>
            </select>
            <button class="btn btn-secondary btn-sm" id="chat-sessions-btn" title="历史会话">
              📚
            </button>
            <button class="btn btn-secondary btn-sm" id="chat-summarize-btn" title="总结沉淀">
              📝
            </button>
            <button class="btn btn-secondary btn-sm" id="chat-clear-btn" title="清空对话">
              清空
            </button>
          </div>
        </div>
        
        <!-- 会话列表面板 -->
        <div class="chat-sessions-panel" id="chat-sessions-panel" style="display: none;">
          <div class="sessions-panel-header">
            <h3>历史会话</h3>
            <button class="btn btn-sm" id="chat-new-session-btn">+ 新对话</button>
          </div>
          <div class="sessions-list" id="sessions-list"></div>
        </div>
        
        <div class="chat-messages" id="chat-messages">
          <div class="chat-welcome">
            <div class="chat-welcome-icon">🦞</div>
            <h3>欢迎使用 OpenClaw 智能对话</h3>
            <p>我可以帮你：</p>
            <ul>
              <li>📝 撰写文档、报告、邮件</li>
              <li>🔍 搜索和分析信息</li>
              <li>💻 编写和调试代码</li>
              <li>📊 处理 Excel 数据</li>
              <li>🌐 搜索网页获取最新信息</li>
              <li>📁 操作飞书文档和表格</li>
            </ul>
            <p class="chat-hint">输入你的问题或任务，我会尽力帮助你完成。</p>
          </div>
        </div>
        
        <div class="chat-input-area">
          <div class="chat-attachments" id="chat-attachments" style="display:none;"></div>
          <div class="chat-input-container">
            <button class="btn chat-attach-btn" id="chat-attach-btn" title="添加附件" style="flex-shrink:0;">
              📎
            </button>
            <textarea 
              id="chat-input" 
              class="chat-input" 
              placeholder="输入消息... (Shift+Enter 换行，Enter 发送)"
              rows="1"
            ></textarea>
            <button class="btn btn-primary chat-send-btn" id="chat-send-btn" disabled>
              <span class="send-icon">➤</span>
            </button>
          </div>
          <div class="chat-status" id="chat-status"></div>
        </div>
      </div>

      <style>
        .chat-container {
          display: flex;
          flex-direction: column;
          height: calc(100vh - 140px);
          background: var(--bg-primary, #fff);
        }
        
        .chat-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 0;
          border-bottom: 1px solid var(--border, #e0e0e0);
          margin-bottom: 16px;
        }
        
        .chat-header h2 {
          margin: 0;
          font-size: 18px;
        }
        
        .chat-settings {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        
        .chat-setting-item {
          display: flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          font-size: 13px;
          color: var(--text-secondary);
        }
        
        .chat-setting-item input[type="checkbox"] {
          width: 16px;
          height: 16px;
        }
        
        /* 会话列表面板样式 */
        .chat-sessions-panel {
          position: absolute;
          top: 60px;
          right: 20px;
          width: 320px;
          max-height: 400px;
          background: var(--bg-primary, #fff);
          border: 1px solid var(--border, #e0e0e0);
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          z-index: 100;
          overflow: hidden;
        }
        
        .sessions-panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-bottom: 1px solid var(--border, #e0e0e0);
          background: var(--bg-secondary, #f5f5f5);
        }
        
        .sessions-panel-header h3 {
          margin: 0;
          font-size: 14px;
        }
        
        .sessions-list {
          max-height: 340px;
          overflow-y: auto;
        }
        
        .session-item {
          padding: 12px 16px;
          border-bottom: 1px solid var(--border, #e0e0e0);
          cursor: pointer;
          transition: background 0.2s;
        }
        
        .session-item:hover {
          background: var(--bg-secondary, #f5f5f5);
        }
        
        .session-item.active {
          background: var(--primary-light, rgba(74, 144, 217, 0.1));
        }
        
        .session-item-title {
          font-size: 14px;
          font-weight: 500;
          margin-bottom: 4px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        
        .session-item-meta {
          font-size: 12px;
          color: var(--text-muted);
        }
        
        .session-item-delete {
          float: right;
          color: var(--danger, #d32f2f);
          opacity: 0;
          transition: opacity 0.2s;
        }
        
        .session-item:hover .session-item-delete {
          opacity: 1;
        }
        
        .chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 0 4px;
        }
        
        .chat-welcome {
          text-align: center;
          padding: 60px 20px;
          color: var(--text-secondary);
        }
        
        .chat-welcome-icon {
          font-size: 48px;
          margin-bottom: 16px;
        }
        
        .chat-welcome h3 {
          margin: 0 0 16px 0;
          color: var(--text-primary);
        }
        
        .chat-welcome ul {
          list-style: none;
          padding: 0;
          margin: 16px 0;
          text-align: left;
          display: inline-block;
        }
        
        .chat-welcome li {
          padding: 8px 0;
          font-size: 14px;
        }
        
        .chat-hint {
          font-size: 13px;
          color: var(--text-muted);
          margin-top: 24px;
        }
        
        .chat-message {
          display: flex;
          gap: 12px;
          margin-bottom: 20px;
          animation: fadeIn 0.3s ease;
        }
        
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .chat-message.user {
          flex-direction: row-reverse;
        }
        
        .chat-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          flex-shrink: 0;
        }
        
        .chat-message.assistant .chat-avatar {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        
        .chat-message.user .chat-avatar {
          background: var(--primary, #4a90d9);
        }
        
        .chat-bubble {
          max-width: 75%;
          padding: 12px 16px;
          border-radius: 16px;
          line-height: 1.6;
          font-size: 14px;
          /* 允许文本选择 */
          user-select: text;
          -webkit-user-select: text;
          cursor: text;
        }
        
        .chat-message.assistant .chat-bubble {
          background: var(--bg-secondary, #f5f5f5);
          border-bottom-left-radius: 4px;
        }
        
        .chat-message.user .chat-bubble {
          background: var(--primary, #4a90d9);
          color: white;
          border-bottom-right-radius: 4px;
          white-space: pre-wrap;
          word-break: break-word;
        }
        
        .chat-bubble pre {
          background: var(--bg-code, #1e1e1e);
          color: var(--text-code, #d4d4d4);
          padding: 12px;
          border-radius: 8px;
          overflow-x: auto;
          margin: 8px 0;
          font-size: 13px;
          position: relative;
        }
        
        .chat-bubble pre .copy-btn {
          position: absolute;
          top: 4px;
          right: 4px;
          padding: 4px 8px;
          font-size: 11px;
          background: rgba(255, 255, 255, 0.1);
          border: none;
          border-radius: 4px;
          color: #fff;
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.2s;
        }
        
        .chat-bubble pre:hover .copy-btn {
          opacity: 1;
        }
        
        .chat-bubble code {
          background: var(--bg-code-inline, rgba(0,0,0,0.1));
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 13px;
        }
        
        .chat-message.user .chat-bubble code {
          background: rgba(255,255,255,0.2);
        }
        
        .chat-bubble p {
          margin: 0 0 8px 0;
        }
        
        .chat-bubble p:last-child {
          margin-bottom: 0;
        }
        
        .chat-thinking {
          padding: 8px 12px;
          background: var(--bg-tertiary, #e8e8e8);
          border-radius: 8px;
          margin-bottom: 8px;
          font-size: 13px;
          color: var(--text-muted);
          font-style: italic;
        }
        
        .chat-input-area {
          border-top: 1px solid var(--border, #e0e0e0);
          padding-top: 16px;
          margin-top: 16px;
        }

        /* 附件预览列表 */
        .chat-attachments {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 8px;
          padding: 8px 10px;
          background: var(--bg-secondary, #f5f5f5);
          border: 1px solid var(--border, #e0e0e0);
          border-radius: 8px;
        }
        .attachment-tag {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 3px 8px 3px 10px;
          background: var(--bg-primary, #fff);
          border: 1px solid var(--border, #e0e0e0);
          border-radius: 14px;
          font-size: 12px;
          color: var(--text-secondary);
          max-width: 200px;
        }
        .attachment-tag.error {
          border-color: var(--danger, #d32f2f);
          color: var(--danger, #d32f2f);
          background: rgba(211, 47, 47, 0.05);
        }
        .attachment-tag-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 140px;
        }
        .attachment-tag-size {
          color: var(--text-muted);
          font-size: 11px;
          flex-shrink: 0;
        }
        .attachment-tag-remove {
          flex-shrink: 0;
          cursor: pointer;
          padding: 0 2px;
          color: var(--text-muted);
          font-size: 14px;
          line-height: 1;
          border: none;
          background: none;
        }
        .attachment-tag-remove:hover {
          color: var(--danger, #d32f2f);
        }

        /* 附件按钮 */
        .chat-attach-btn {
          width: 44px;
          height: 44px;
          padding: 0;
          border-radius: 12px;
          font-size: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-secondary, #f5f5f5);
          border: 1px solid var(--border, #e0e0e0);
          color: var(--text-secondary);
          cursor: pointer;
          transition: background 0.15s;
        }
        .chat-attach-btn:hover {
          background: var(--bg-tertiary, #ebebeb);
        }
        .chat-attach-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        /* 用户消息附件展示 */
        .chat-msg-attachments {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-top: 6px;
        }
        .chat-msg-attachment {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 8px;
          background: rgba(255,255,255,0.15);
          border-radius: 10px;
          font-size: 11px;
          white-space: nowrap;
        }
        
        .chat-input-container {
          display: flex;
          gap: 8px;
          align-items: flex-end;
        }
        
        .chat-input {
          flex: 1;
          padding: 12px 16px;
          border: 1px solid var(--border, #e0e0e0);
          border-radius: 12px;
          font-size: 14px;
          resize: none;
          max-height: 200px;
          line-height: 1.5;
          background: var(--bg-input, #fff);
          color: var(--text-primary);
        }
        
        .chat-input:focus {
          outline: none;
          border-color: var(--primary, #4a90d9);
          box-shadow: 0 0 0 3px rgba(74, 144, 217, 0.1);
        }
        
        .chat-send-btn {
          width: 44px;
          height: 44px;
          padding: 0;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .chat-send-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .send-icon {
          font-size: 18px;
        }
        
        .chat-status {
          font-size: 12px;
          color: var(--text-muted);
          margin-top: 8px;
          min-height: 18px;
        }
        
        .chat-status.streaming {
          color: var(--primary, #4a90d9);
        }
        
        .chat-status.error {
          color: var(--danger, #d32f2f);
        }
        
        .typing-indicator {
          display: flex;
          gap: 4px;
          padding: 8px 0;
        }
        
        .typing-dot {
          width: 8px;
          height: 8px;
          background: var(--text-muted);
          border-radius: 50%;
          animation: typing 1.4s infinite ease-in-out;
        }
        
        .typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .typing-dot:nth-child(3) { animation-delay: 0.4s; }
        
        @keyframes typing {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-10px); }
        }
        
        /* 总结提示样式 */
        .summarize-hint {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 12px 16px;
          border-radius: 8px;
          margin-bottom: 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .summarize-hint button {
          background: rgba(255, 255, 255, 0.2);
          border: none;
          padding: 6px 12px;
          border-radius: 4px;
          color: white;
          cursor: pointer;
        }
        
        /* Markdown 渲染样式 */
        .chat-bubble h1, .chat-bubble h2, .chat-bubble h3 {
          margin: 16px 0 8px 0;
          font-size: 16px;
        }
        
        .chat-bubble h1:first-child, .chat-bubble h2:first-child, .chat-bubble h3:first-child {
          margin-top: 0;
        }
        
        .chat-bubble ul, .chat-bubble ol {
          margin: 8px 0;
          padding-left: 20px;
        }
        
        .chat-bubble li {
          margin: 4px 0;
        }
        
        .chat-bubble blockquote {
          margin: 8px 0;
          padding: 8px 16px;
          border-left: 4px solid var(--primary, #4a90d9);
          background: var(--bg-tertiary, #f0f0f0);
        }
        
        .chat-bubble table {
          border-collapse: collapse;
          margin: 8px 0;
        }
        
        .chat-bubble th, .chat-bubble td {
          border: 1px solid var(--border, #e0e0e0);
          padding: 6px 12px;
          text-align: left;
        }
        
        .chat-bubble th {
          background: var(--bg-secondary, #f5f5f5);
        }

        /* ===== 思考过程卡片样式 ===== */
        .thinking-card {
          margin-bottom: 8px;
          border-radius: 8px;
          overflow: hidden;
          border: 1px solid rgba(102, 126, 234, 0.3);
          background: rgba(102, 126, 234, 0.06);
          transition: all 0.2s ease;
        }

        .thinking-card-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          cursor: pointer;
          user-select: none;
          font-size: 12px;
          color: #667eea;
          font-weight: 500;
          background: rgba(102, 126, 234, 0.1);
          transition: background 0.15s ease;
        }

        .thinking-card-header:hover {
          background: rgba(102, 126, 234, 0.18);
        }

        .thinking-card-icon {
          font-size: 14px;
          flex-shrink: 0;
        }

        .thinking-card-label {
          flex: 1;
        }

        .thinking-card-toggle {
          font-size: 10px;
          color: #667eea;
          opacity: 0.7;
          transition: transform 0.2s ease;
          flex-shrink: 0;
        }

        .thinking-card.expanded .thinking-card-toggle {
          transform: rotate(180deg);
        }

        .thinking-card-body {
          padding: 10px 14px;
          font-size: 12px;
          color: var(--text-secondary, #666);
          line-height: 1.6;
          white-space: pre-wrap;
          word-break: break-word;
          max-height: 300px;
          overflow-y: auto;
          display: none;
          border-top: 1px solid rgba(102, 126, 234, 0.15);
          font-style: italic;
        }

        .thinking-card.expanded .thinking-card-body {
          display: block;
        }

        .thinking-card.streaming .thinking-card-header {
          background: linear-gradient(90deg, rgba(102,126,234,0.15) 0%, rgba(118,75,162,0.15) 100%);
        }

        .thinking-card.streaming .thinking-card-label::after {
          content: '...';
          display: inline-block;
          animation: thinkingDots 1.2s infinite;
        }

        @keyframes thinkingDots {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }

        .thinking-card-cursor {
          display: inline-block;
          width: 2px;
          height: 1em;
          background: #667eea;
          vertical-align: text-bottom;
          animation: blink 0.8s infinite;
          margin-left: 1px;
        }

        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }

        /* ===== 右键菜单样式 ===== */
        .chat-context-menu {
          position: fixed;
          background: var(--bg-primary, #fff);
          border: 1px solid var(--border, #e0e0e0);
          border-radius: 8px;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
          z-index: 9999;
          min-width: 160px;
          padding: 4px 0;
          animation: menuFadeIn 0.1s ease;
          overflow: hidden;
        }

        @keyframes menuFadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }

        .context-menu-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 16px;
          font-size: 13px;
          color: var(--text-primary, #333);
          cursor: pointer;
          transition: background 0.1s;
          white-space: nowrap;
        }

        .context-menu-item:hover {
          background: var(--bg-secondary, #f5f5f5);
          color: var(--primary, #4a90d9);
        }

        .context-menu-item.disabled {
          color: var(--text-muted, #999);
          cursor: default;
        }

        .context-menu-item.disabled:hover {
          background: transparent;
          color: var(--text-muted, #999);
        }

        .context-menu-icon {
          font-size: 14px;
          width: 16px;
          text-align: center;
          flex-shrink: 0;
        }

        .context-menu-divider {
          height: 1px;
          background: var(--border, #e0e0e0);
          margin: 4px 0;
        }

        .context-menu-item.danger {
          color: var(--danger, #d32f2f);
        }

        .context-menu-item.danger:hover {
          background: rgba(211, 47, 47, 0.08);
          color: var(--danger, #d32f2f);
        }

        /* ===== 等待进度卡片 ===== */
        .waiting-card {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 14px 16px;
          background: var(--bg-secondary, #282840);
          border: 1px solid var(--border, #3a3a52);
          border-radius: 12px;
          border-bottom-left-radius: 4px;
          min-width: 220px;
          max-width: 320px;
        }

        .waiting-card-row {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 13px;
          color: var(--text-secondary, #a0a0b0);
        }

        .waiting-phase-icon {
          font-size: 16px;
          flex-shrink: 0;
          width: 20px;
          text-align: center;
        }

        .waiting-phase-label {
          flex: 1;
          font-weight: 500;
        }

        .waiting-timer {
          font-size: 12px;
          color: var(--text-muted, #6e6e80);
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
        }

        .waiting-steps {
          display: flex;
          flex-direction: column;
          gap: 5px;
          padding-left: 2px;
        }

        .waiting-step {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--text-muted, #6e6e80);
          transition: color 0.3s ease;
        }

        .waiting-step.active {
          color: var(--text-primary, #e0e0e0);
        }

        .waiting-step.done {
          color: var(--success, #66bb6a);
        }

        .waiting-step-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--border-light, #4a4a62);
          flex-shrink: 0;
          transition: background 0.3s ease;
        }

        .waiting-step.active .waiting-step-dot {
          background: #667eea;
          box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.25);
          animation: stepPulse 1.2s infinite;
        }

        .waiting-step.done .waiting-step-dot {
          background: var(--success, #66bb6a);
        }

        @keyframes stepPulse {
          0%, 100% { box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.25); }
          50% { box-shadow: 0 0 0 5px rgba(102, 126, 234, 0.1); }
        }

        .waiting-spinner-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .waiting-spinner {
          width: 14px;
          height: 14px;
          border: 2px solid rgba(102, 126, 234, 0.2);
          border-top-color: #667eea;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          flex-shrink: 0;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      </style>
    `;

    // 绑定事件
    this._bindEvents();
    
    // 订阅流式响应
    this._subscribeStream();
    
    // 加载代理和技能列表
    await this._loadMetadata();
    
    // 渲染已加载的消息
    if (this._messages.length > 0) {
      this._renderMessages();
    }
  },

  _bindEvents() {
    const input = $('#chat-input');
    const sendBtn = $('#chat-send-btn');
    const clearBtn = $('#chat-clear-btn');
    const thinkingSelect = $('#chat-thinking');
    const localModeCheck = $('#chat-local-mode');
    const sessionsBtn = $('#chat-sessions-btn');
    const sessionsPanel = $('#chat-sessions-panel');
    const newSessionBtn = $('#chat-new-session-btn');
    const summarizeBtn = $('#chat-summarize-btn');

    // 输入框事件
    input?.addEventListener('input', () => {
      this._updateSendButton();
      this._autoResizeInput();
    });

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._sendMessage();
      }
    });

    // 附件按钮
    const attachBtn = $('#chat-attach-btn');
    attachBtn?.addEventListener('click', () => this._selectAttachments());

    // 发送按钮
    sendBtn?.addEventListener('click', () => this._sendMessage());

    // 清空按钮
    clearBtn?.addEventListener('click', () => this._clearChat());

    // 思考级别选择
    thinkingSelect?.addEventListener('change', (e) => {
      this._thinkingLevel = e.target.value;
    });

    // 本地模式切换 - 默认使用 gateway 模式（更稳定）
    localModeCheck?.addEventListener('change', (e) => {
      this._useLocalMode = e.target.checked;
    });
    
    // 默认不勾选本地模式，使用 gateway
    if (localModeCheck) {
      localModeCheck.checked = false;
      this._useLocalMode = false;
    }
    
    // 会话列表按钮
    sessionsBtn?.addEventListener('click', () => this._toggleSessionsPanel());
    
    // 新建会话按钮
    newSessionBtn?.addEventListener('click', () => this._createNewSession());
    
    // 总结按钮
    summarizeBtn?.addEventListener('click', () => this._requestSummary());
    
    // 点击外部关闭会话面板
    document.addEventListener('click', (e) => {
      if (sessionsPanel && sessionsPanel.style.display !== 'none') {
        if (!sessionsPanel.contains(e.target) && e.target !== sessionsBtn) {
          sessionsPanel.style.display = 'none';
          this._showSessionList = false;
        }
      }
      // 点击任意位置关闭右键菜单
      this._hideContextMenu();
    });

    // 右键菜单：监听对话消息区域的 contextmenu 事件
    const messagesContainer = $('#chat-messages');
    messagesContainer?.addEventListener('contextmenu', (e) => {
      this._showContextMenu(e);
    });

    // 按 Escape 关闭右键菜单
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this._hideContextMenu();
      }
    });
  },

  /**
   * 选择附件文件（通过系统对话框）
   */
  async _selectAttachments() {
    try {
      const result = await window.openclawAPI.dialog.selectFiles();
      if (!result.success || !result.files || result.files.length === 0) return;

      for (const file of result.files) {
        // 避免重复添加
        if (this._attachments.find(a => a.name === file.name && a.path === file.path)) continue;
        this._attachments.push(file);
      }
      this._renderAttachments();
      this._updateSendButton();
    } catch (err) {
      console.error('selectAttachments error:', err);
    }
  },

  /**
   * 渲染附件预览列表
   */
  _renderAttachments() {
    const container = $('#chat-attachments');
    if (!container) return;

    if (this._attachments.length === 0) {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    container.style.display = 'flex';
    container.innerHTML = this._attachments.map((file, idx) => {
      if (file.error) {
        return `<div class="attachment-tag error" title="${this._escapeHtml(file.error)}">
          <span>⚠️</span>
          <span class="attachment-tag-name">${this._escapeHtml(file.name)}</span>
          <button class="attachment-tag-remove" onclick="TabChat._removeAttachment(${idx})" title="移除">×</button>
        </div>`;
      }
      const sizeText = file.size < 1024 ? `${file.size}B` : `${Math.round(file.size / 1024)}KB`;
      return `<div class="attachment-tag" title="${this._escapeHtml(file.name)}">
        <span>📄</span>
        <span class="attachment-tag-name">${this._escapeHtml(file.name)}</span>
        <span class="attachment-tag-size">${sizeText}</span>
        <button class="attachment-tag-remove" onclick="TabChat._removeAttachment(${idx})" title="移除">×</button>
      </div>`;
    }).join('');
  },

  /** 移除指定附件 */
  _removeAttachment(idx) {
    this._attachments.splice(idx, 1);
    this._renderAttachments();
    this._updateSendButton();
  },

  /**
   * 加载最近的会话（使用分页加载，只加载最近的消息）
   */
  async _loadRecentSession() {
    try {
      const result = await window.openclawAPI.chat.listSessions(1);
      if (result.success && result.sessions && result.sessions.length > 0) {
        const recentSession = result.sessions[0];
        // 使用分页加载，只加载最近的消息
        const loadResult = await window.openclawAPI.chat.loadSessionMessages(recentSession.id, 0, this._messageLoadLimit);
        if (loadResult.success && loadResult.session) {
          this._currentSessionId = loadResult.session.id;
          this._messages = loadResult.session.messages || [];
          this._hasMoreMessages = loadResult.hasMore;
          this._loadedMessageCount = this._messages.length;
          this._totalMessageCount = loadResult.totalCount;
          console.log('Loaded recent session:', this._currentSessionId, 'messages:', this._messages.length, 'hasMore:', this._hasMoreMessages);
        }
      }
    } catch (err) {
      console.error('Failed to load recent session:', err);
    }
  },

  /**
   * 加载更多历史消息（滚动分页）
   */
  async _loadMoreMessages() {
    if (this._isLoadingMore || !this._hasMoreMessages || !this._currentSessionId) {
      return;
    }

    this._isLoadingMore = true;

    try {
      const result = await window.openclawAPI.chat.loadSessionMessages(
        this._currentSessionId, 
        this._loadedMessageCount, 
        this._messageLoadLimit
      );

      if (result.success && result.session && result.session.messages) {
        // 将新消息插入到列表开头
        const newMessages = result.session.messages;
        this._messages = [...newMessages, ...this._messages];
        this._loadedMessageCount += newMessages.length;
        this._hasMoreMessages = result.hasMore;

        console.log('Loaded more messages:', newMessages.length, 'hasMore:', this._hasMoreMessages);

        // 如果还有更多消息，添加加载提示
        this._updateLoadMoreIndicator();
      }
    } catch (err) {
      console.error('Failed to load more messages:', err);
    } finally {
      this._isLoadingMore = false;
    }
  },

  /**
   * 更新"加载更多"指示器
   */
  _updateLoadMoreIndicator() {
    const container = $('#chat-messages');
    if (!container) return;

    // 移除旧的指示器
    const oldIndicator = container.querySelector('.load-more-indicator');
    if (oldIndicator) oldIndicator.remove();

    if (this._hasMoreMessages) {
      const indicator = document.createElement('div');
      indicator.className = 'load-more-indicator';
      indicator.innerHTML = `
        <div style="text-align: center; padding: 12px; color: var(--text-muted); font-size: 13px; cursor: pointer;" id="load-more-btn">
          ${this._isLoadingMore ? '加载中...' : `加载更多历史消息 (${this._loadedMessageCount}/${this._totalMessageCount})`}
        </div>
      `;
      // 插入到最前面
      container.insertBefore(indicator, container.firstChild);

      // 绑定点击事件
      $('#load-more-btn')?.addEventListener('click', () => this._loadMoreMessages());
    }
  },

  /**
   * 切换会话列表面板
   */
  async _toggleSessionsPanel() {
    const panel = $('#chat-sessions-panel');
    if (!panel) return;
    
    if (this._showSessionList) {
      panel.style.display = 'none';
      this._showSessionList = false;
    } else {
      // 加载会话列表
      await this._loadSessionsList();
      panel.style.display = 'block';
      this._showSessionList = true;
    }
  },

  /**
   * 加载会话列表
   */
  async _loadSessionsList() {
    const listContainer = $('#sessions-list');
    if (!listContainer) return;
    
    try {
      const result = await window.openclawAPI.chat.listSessions(20);
      if (result.success && result.sessions) {
        this._sessions = result.sessions;
        
        if (result.sessions.length === 0) {
          listContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">暂无历史会话</div>';
          return;
        }
        
        let html = '';
        for (const session of result.sessions) {
          const isActive = session.id === this._currentSessionId;
          const timeStr = this._formatTime(session.updatedAt);
          html += `
            <div class="session-item ${isActive ? 'active' : ''}" data-session-id="${session.id}">
              <span class="session-item-delete" data-delete-id="${session.id}">✕</span>
              <div class="session-item-title">${this._escapeHtml(session.title)}</div>
              <div class="session-item-meta">${session.messageCount} 条消息 · ${timeStr}</div>
            </div>
          `;
        }
        listContainer.innerHTML = html;
        
        // 绑定点击事件
        listContainer.querySelectorAll('.session-item').forEach(item => {
          item.addEventListener('click', (e) => {
            if (e.target.classList.contains('session-item-delete')) {
              e.stopPropagation();
              this._deleteSession(e.target.dataset.deleteId);
            } else {
              this._switchToSession(item.dataset.sessionId);
            }
          });
        });
      }
    } catch (err) {
      console.error('Failed to load sessions list:', err);
      listContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--danger);">加载失败</div>';
    }
  },

  /**
   * 切换到指定会话（使用分页加载）
   */
  async _switchToSession(sessionId) {
    try {
      // 先保存当前会话
      await this._saveCurrentSession();
      
      // 使用分页加载，只加载最近的消息
      const result = await window.openclawAPI.chat.loadSessionMessages(sessionId, 0, this._messageLoadLimit);
      if (result.success && result.session) {
        this._currentSessionId = result.session.id;
        this._messages = result.session.messages || [];
        this._hasMoreMessages = result.hasMore;
        this._loadedMessageCount = this._messages.length;
        this._totalMessageCount = result.totalCount;
        this._renderMessages();
        
        // 关闭面板
        const panel = $('#chat-sessions-panel');
        if (panel) {
          panel.style.display = 'none';
          this._showSessionList = false;
        }
        
        this._setStatus(`已加载会话`);
      }
    } catch (err) {
      console.error('Failed to switch session:', err);
      this._setStatus('切换会话失败', 'error');
    }
  },

  /**
   * 删除会话
   */
  async _deleteSession(sessionId) {
    if (!confirm('确定要删除这个会话吗？')) return;
    
    try {
      await window.openclawAPI.chat.deleteSession(sessionId);
      
      // 如果删除的是当前会话，创建新会话
      if (sessionId === this._currentSessionId) {
        this._createNewSession();
      }
      
      // 刷新列表
      await this._loadSessionsList();
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  },

  /**
   * 创建新会话
   */
  async _createNewSession() {
    // 先保存当前会话
    await this._saveCurrentSession();
    
    // 创建新会话
    this._currentSessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    this._messages = [];
    this._renderMessages();
    
    // 关闭面板
    const panel = $('#chat-sessions-panel');
    if (panel) {
      panel.style.display = 'none';
      this._showSessionList = false;
    }
    
    this._setStatus('新会话已创建');
  },

  /**
   * 保存当前会话
   */
  async _saveCurrentSession() {
    if (!this._currentSessionId || this._messages.length === 0) return;
    
    try {
      const title = this._generateSessionTitle();
      await window.openclawAPI.chat.saveSession(this._currentSessionId, this._messages, {
        title,
        createdAt: this._messages[0]?.timestamp || Date.now()
      });
    } catch (err) {
      console.error('Failed to save session:', err);
    }
  },

  /**
   * 生成会话标题
   */
  _generateSessionTitle() {
    const firstUserMsg = this._messages.find(m => m.role === 'user');
    if (firstUserMsg?.content) {
      const title = firstUserMsg.content.substring(0, 50);
      return title.length < firstUserMsg.content.length ? title + '...' : title;
    }
    return '新对话';
  },

  /**
   * 格式化时间
   */
  _formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前';
    
    return date.toLocaleDateString();
  },

  /**
   * 请求总结
   */
  async _requestSummary() {
    if (this._messages.length < 2) {
      this._setStatus('消息太少，无法总结');
      return;
    }
    
    this._setStatus('正在生成总结...');
    
    // 构建总结请求
    const conversationText = this._messages.map(m => 
      `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`
    ).join('\n\n');
    
    const summaryPrompt = `请对以下对话内容进行阶段性总结，提取关键知识点和重要信息：

${conversationText}

请按以下格式输出：

## 对话总结
[简要总结本次对话的主要内容和目标]

## 关键知识点
1. [知识点1]
2. [知识点2]
...

## 待解决问题
- [问题1]
- [问题2]
...

## 后续建议
[对后续工作的建议]`;

    // 发送总结请求
    const input = $('#chat-input');
    if (input) {
      input.value = summaryPrompt;
      this._updateSendButton();
      this._sendMessage();
    }
  },

  _subscribeStream() {
    // 取消之前的订阅
    if (this._streamUnsubscribe) {
      this._streamUnsubscribe();
    }
    if (this._imUnsubscribe) {
      this._imUnsubscribe();
      window.openclawAPI.chat.stopImWatch();
    }

    // 订阅流式响应
    this._streamUnsubscribe = window.openclawAPI.chat.onStream((data) => {
      this._handleStream(data);
    });

    // 订阅 IM 渠道外部消息（飞书/钉钉等）
    this._imUnsubscribe = window.openclawAPI.chat.onImMessage((msg) => {
      this._handleImMessage(msg);
    });
    window.openclawAPI.chat.startImWatch();
  },

  /**
   * 处理来自 IM 渠道的外部消息（飞书/钉钉/微信/QQ）
   * 将消息展示在智能对话面板，与管理员自己发送的消息区分开来
   */
  _handleImMessage(msg) {
    if (!msg || !msg.content) return;

    const CHANNEL_LABELS = {
      feishu: '飞书', dingtalk: '钉钉', wechat: '微信', qq: 'QQ', lark: '飞书'
    };
    const channelLabel = CHANNEL_LABELS[msg.channel] || msg.channel || 'IM';
    const senderLabel = msg.sender && msg.sender !== 'assistant'
      ? `${channelLabel} · ${msg.sender}`
      : channelLabel;

    if (msg.role === 'user') {
      // IM 用户消息：以特殊样式展示，区分于管理员自己在面板里发的消息
      this._messages.push({
        role: 'user',
        content: msg.content,
        timestamp: msg.timestamp || Date.now(),
        isImMessage: true,
        imChannel: msg.channel,
        imSender: senderLabel
      });
    } else {
      // agent 回复 IM 消息
      this._messages.push({
        role: 'assistant',
        content: msg.content,
        timestamp: msg.timestamp || Date.now(),
        isImReply: true,
        imChannel: msg.channel
      });
    }

    // 重新渲染，使新消息可见
    this._renderMessages();

    // 自动保存会话
    this._autoSaveSession();
  },

  _handleStream(data) {
    const { type, data: content } = data;
    
    // 更新最后一条助手消息
    const lastMessage = this._messages[this._messages.length - 1];
    
    // 对 'data' 和 'thinking' 类型，允许在 _isStreaming 关闭后短暂窗口内继续处理
    // 因为 IPC 异步传输可能有延迟，数据在 await send() 返回后才到达前端
    if (!this._isStreaming) {
      // 只允许关键数据类型在关闭后的短暂窗口内通过
      if (type !== 'data' && type !== 'thinking') {
        return;
      }
      // 如果最后一条消息不是 assistant 或者已经不在对话上下文中，也应该退出
      if (!lastMessage || lastMessage.role !== 'assistant') {
        return;
      }
    }
    if (lastMessage && lastMessage.role === 'assistant') {
      if (type === 'thinking_start') {
        // 思考开始：切换到思考阶段，初始化思考内容
        this._setWaitingPhase('thinking');
        this._isThinking = true;
        this._currentThinkingContent = '';
        lastMessage.thinking = '';
        lastMessage.thinkingDone = false;
        this._renderStreamingMessage(lastMessage);
      } else if (type === 'thinking') {
        // 思考中：实时追加思考内容
        this._currentThinkingContent += content;
        lastMessage.thinking = this._currentThinkingContent;
        lastMessage.thinkingDone = false;
        this._renderStreamingMessage(lastMessage);
        // 思考卡片 body 自动滚到底
        this._scrollThinkingBody();
      } else if (type === 'thinking_end') {
        // 思考结束：标记完成，收缩卡片
        this._isThinking = false;
        lastMessage.thinking = this._currentThinkingContent;
        lastMessage.thinkingDone = true;
        // Gateway 返回 200 时会触发 thinking_end（即使没有走思考阶段）
        // 此时 waitingPhase 可能还在 'connecting'，立刻切换到 'generating' 给用户反馈
        // 同时隐藏等待指示器，后续内容由 _renderStreamingMessage 实时渲染
        this._setWaitingPhase('generating');
        this._hideTypingIndicator();
        this._renderStreamingMessage(lastMessage);
      } else if (type === 'cli_fallback') {
        // Gateway 不可用，已降级到 CLI 模式
        // 此时 Gateway 没有发过 thinking_end，等待指示器仍在运行
        // 只需切换阶段文字就好，不需要重新 show（指示器未被隐藏）
        this._setWaitingPhase('thinking');
      } else if (type === 'data') {
        // 正式内容开始：切换到生成阶段
        if (!lastMessage.content) {
          this._setWaitingPhase('generating');
          // 立即隐藏等待指示器，让真实内容气泡接管
          this._hideTypingIndicator();
        }
        lastMessage.content += content;
        this._renderStreamingMessage(lastMessage);
      } else if (type === 'stderr') {
        console.log('Stream stderr:', content);
      }
    }
  },

  /** 让思考卡片的 body 滚到底部（流式追加时保持可见最新内容） */
  _scrollThinkingBody() {
    const container = $('#chat-messages');
    if (!container) return;
    const allMsgs = container.querySelectorAll('.chat-message.assistant');
    const lastMsgEl = allMsgs[allMsgs.length - 1];
    if (!lastMsgEl) return;
    const body = lastMsgEl.querySelector('.thinking-card-body');
    if (body) body.scrollTop = body.scrollHeight;
  },

  /**
   * 实时渲染流式消息（仅更新最后一条助手消息，性能更优）
   */
  _renderStreamingMessage(message) {
    const container = $('#chat-messages');
    if (!container) return;

    // 找到最后一个 assistant 消息气泡（排除 typing-message）
    const allMsgs = container.querySelectorAll('.chat-message.assistant:not(.typing-message)');
    const lastMsgEl = allMsgs[allMsgs.length - 1];

    if (!lastMsgEl) {
      // 没有气泡（初始空助手消息被跳过），新建一个
      this._appendAssistantBubble(message);
      return;
    }

    const bubble = lastMsgEl.querySelector('.chat-bubble');
    if (!bubble) return;

    bubble.innerHTML = this._buildMessageHtml(message);

    // 绑定代码块复制按钮
    bubble.querySelectorAll('pre').forEach(pre => {
      if (pre.querySelector('.copy-btn')) return;
      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-btn';
      copyBtn.textContent = '复制';
      copyBtn.addEventListener('click', () => {
        const code = pre.querySelector('code')?.textContent || pre.textContent;
        navigator.clipboard.writeText(code).then(() => {
          copyBtn.textContent = '已复制';
          setTimeout(() => copyBtn.textContent = '复制', STYLES.copyButtonResetTime);
        });
      });
      pre.style.position = 'relative';
      pre.appendChild(copyBtn);
    });

    // 绑定思考卡片展开/折叠
    const thinkingCard = bubble.querySelector('.thinking-card');
    if (thinkingCard) {
      const header = thinkingCard.querySelector('.thinking-card-header');
      header?.addEventListener('click', () => {
        thinkingCard.classList.toggle('expanded');
      });
    }

    // 滚动到底部
    container.scrollTop = container.scrollHeight;
  },

  /**
   * 在消息列表中追加一个新的助手气泡（流式首个内容到达时调用）
   */
  _appendAssistantBubble(message) {
    const container = $('#chat-messages');
    if (!container) return;

    // 移除 typing-message（等待卡片让位给真实气泡）
    const typingMsg = container.querySelector('.typing-message');

    const msgEl = document.createElement('div');
    msgEl.className = 'chat-message assistant';
    const bubbleHtml = this._buildMessageHtml(message);
    msgEl.innerHTML = `
      <div class="chat-avatar">🦞</div>
      <div class="chat-bubble">${bubbleHtml}</div>
    `;

    // 将新气泡插在 typing-message 之前（如果存在），否则追加到末尾
    if (typingMsg) {
      container.insertBefore(msgEl, typingMsg);
    } else {
      container.appendChild(msgEl);
    }

    // 绑定代码块复制
    msgEl.querySelectorAll('pre').forEach(pre => {
      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-btn';
      copyBtn.textContent = '复制';
      copyBtn.addEventListener('click', () => {
        const code = pre.querySelector('code')?.textContent || pre.textContent;
        navigator.clipboard.writeText(code).then(() => {
          copyBtn.textContent = '已复制';
          setTimeout(() => copyBtn.textContent = '复制', STYLES.copyButtonResetTime);
        });
      });
      pre.style.position = 'relative';
      pre.appendChild(copyBtn);
    });

    // 绑定思考卡片
    const thinkingCard = msgEl.querySelector('.thinking-card');
    if (thinkingCard) {
      const header = thinkingCard.querySelector('.thinking-card-header');
      header?.addEventListener('click', () => thinkingCard.classList.toggle('expanded'));
    }

    container.scrollTop = container.scrollHeight;
  },

  /**
   * 构建单条消息气泡内部 HTML（思考卡片 + 正文）
   */
  _buildMessageHtml(message) {
    let html = '';

    // 思考卡片
    if (message.thinking !== undefined && message.thinking !== null) {
      const isDone = message.thinkingDone;
      const thinkingText = message.thinking || '';
      const cardClass = isDone ? 'thinking-card' : 'thinking-card streaming expanded';
      const toggleIcon = isDone ? '▼' : '▲';
      const label = isDone ? '已完成思考' : '正在思考中';
      const thinkingLines = this._escapeHtml(thinkingText);

      html += `
        <div class="${cardClass}" data-thinking>
          <div class="thinking-card-header">
            <span class="thinking-card-icon">🧠</span>
            <span class="thinking-card-label">${label}</span>
            <span class="thinking-card-toggle">${toggleIcon}</span>
          </div>
          <div class="thinking-card-body">${thinkingLines}${!isDone ? '<span class="thinking-card-cursor"></span>' : ''}</div>
        </div>
      `;
    }

    // 正文内容
    if (message.content) {
      html += this._renderMarkdown(message.content);
    } else if (!message.thinking) {
      // 没有思考也没有内容：显示光标
      html += '<span class="thinking-card-cursor"></span>';
    }

    return html;
  },

  async _loadMetadata() {
    try {
      // 加载代理列表
      const agentsResult = await window.openclawAPI.chat.listAgents();
      if (agentsResult.success) {
        this._agents = agentsResult.agents || [];
      }
      
      // 加载技能列表
      const skillsResult = await window.openclawAPI.chat.listSkills();
      if (skillsResult.success) {
        this._skills = skillsResult.skills || [];
      }
    } catch (err) {
      console.error('Failed to load metadata:', err);
    }
  },

  _updateSendButton() {
    const input = $('#chat-input');
    const sendBtn = $('#chat-send-btn');
    if (!input || !sendBtn) return;
    
    const hasContent = input.value.trim().length > 0;
    sendBtn.disabled = !hasContent || this._isStreaming;
  },

  _autoResizeInput() {
    const input = $('#chat-input');
    if (!input) return;
    
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  },

  async _sendMessage() {
    const input = $('#chat-input');
    if (!input) return;

    const message = input.value.trim();
    if (!message || this._isStreaming) return;

    // 清理上一轮可能残留的空占位助手消息（如取消/异常时未填内容）
    const lastMsg = this._messages[this._messages.length - 1];
    if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.content && !lastMsg.thinking) {
      this._messages.pop();
    }

    // 拼接附件内容到发送消息（仅限无错误的附件）
    const validAttachments = this._attachments.filter(a => !a.error && a.content);
    let fullMessage = message;
    if (validAttachments.length > 0) {
      const attachParts = validAttachments.map(a =>
        `\n\n---《附件：${a.name}》---\n${a.content}\n---\u300a附件结束》---`
      );
      fullMessage = message + attachParts.join('');
    }

    // 添加用户消息（展示时只显文本，附件单独展示标签）
    this._messages.push({
      role: 'user',
      content: message,
      attachments: validAttachments.map(a => ({ name: a.name, size: a.size })),
      timestamp: Date.now()
    });

    // 清空输入框和附件
    input.value = '';
    this._attachments = [];
    this._renderAttachments();
    this._autoResizeInput();
    this._updateSendButton();

    // 渲染消息
    this._renderMessages();

    // 显示加载状态
    this._showTypingIndicator();
    this._setStatus('正在连接服务...', 'streaming');

    // 添加空的助手消息占位符
    this._messages.push({
      role: 'assistant',
      content: '',
      timestamp: Date.now()
    });

    this._isStreaming = true;
    this._isThinking = false;
    this._currentThinkingContent = '';

    try {
      const options = {
        message: fullMessage,
        sessionId: this._currentSessionId,
        thinking: this._thinkingLevel
      };

      let result;
      if (this._useLocalMode) {
        result = await window.openclawAPI.chat.sendLocal(options);
      } else {
        result = await window.openclawAPI.chat.send(options);
      }

      // 给 IPC 管道时间交付剩余流式数据
      // await send() 返回时，后端的 webContents.send('chat:stream') 可能尚未全部到达
      // ★ 增加等待时间：CLI 模式下 IPC 异步传输可能需要更长时间
      await new Promise(resolve => setTimeout(resolve, 500));
      this._isStreaming = false;

      const lastMessage = this._messages[this._messages.length - 1];
      const hasStreamedContent = lastMessage && lastMessage.role === 'assistant' && !!lastMessage.content;

      if (result.success && !result.error) {
        if (lastMessage && lastMessage.role === 'assistant') {
          // 确保思考卡片标记为完成
          if (lastMessage.thinking !== undefined) {
            lastMessage.thinkingDone = true;
          }

          if (!hasStreamedContent) {
            // 流式阶段没有收到任何内容，用 result 兜底
            let content = result.reply;
            if (!content || content === '（无响应内容）') {
              content = this._extractContentFromStdout(result.stdout);
            }
            if (!content) content = '（无响应内容）';

            if (content === 'Unknown error' || content === '（无响应内容）') {
              // ★ 改进：如果 stdout 非空但解析失败，提供更详细的诊断信息
              let diagInfo = '';
              if (result.stdout && result.stdout.length > 0) {
                diagInfo = `\n\n调试信息：CLI 返回了 ${result.stdout.length} 字节数据但解析失败`;
                // 尝试显示 stdout 中的纯文本部分（去除 JSON 和日志）
                const plainText = this._extractPlainTextFromStdout(result.stdout);
                if (plainText && plainText.length > 20) {
                  // 如果提取到有意义的纯文本，直接显示
                  lastMessage.content = plainText;
                  this._setStatus('');
                  return; // 提前返回，不显示错误
                }
              }
              lastMessage.content = '❌ 大模型调用失败，请检查：\n1. 模型配置是否正确\n2. API Key 是否有效\n3. 模型名称是否正确（如 qwen-plus 而非 qwen3.5-plus）' + diagInfo;
              lastMessage.isError = true;
              this._setStatus('大模型调用失败', 'error');
            } else {
              lastMessage.content = content;
              this._setStatus('');
            }
          } else {
            // 流式已填充内容，只需收尾状态
            this._setStatus('');
          }
        }
      } else {
        // 显示错误
        if (lastMessage && lastMessage.role === 'assistant') {
          if (lastMessage.thinking !== undefined) {
            lastMessage.thinkingDone = true;
          }
          // ★ 增强：确保错误消息不为空
          let errorMsg = result.error || '';
          if (!errorMsg.trim() || errorMsg === 'Unknown error') {
            errorMsg = '大模型调用失败，请检查模型配置和 API Key 是否正确';
          }
          if (!lastMessage.content) {
            lastMessage.content = '❌ 错误: ' + errorMsg;
            lastMessage.isError = true;
          }
        }
        this._setStatus(result.error || '请求失败', 'error');
      }
    } catch (err) {
      this._isStreaming = false;

      const lastMessage = this._messages[this._messages.length - 1];
      if (lastMessage && lastMessage.role === 'assistant') {
        if (lastMessage.thinking !== undefined) {
          lastMessage.thinkingDone = true;
        }
        if (!lastMessage.content) {
          lastMessage.content = '❌ 请求异常: ' + err.message;
          lastMessage.isError = true;
        }
      }
      this._setStatus(err.message, 'error');
    }

    // 隐藏等待指示器
    this._hideTypingIndicator();

    // 最后做一次全量渲染，确保思考卡片状态、错误样式等都同步正确
    // （流式渲染已经实时更新气泡内容，此处只做收尾同步）
    this._renderMessages();
    this._updateSendButton();

    // 自动保存会话
    this._autoSaveSession();

    // 检查是否需要提示总结
    this._checkSummarizeHint();
  },

  /**
   * 自动保存会话（防抖）
   */
  _autoSaveSession() {
    if (this._autoSaveTimer) {
      clearTimeout(this._autoSaveTimer);
    }
    this._autoSaveTimer = setTimeout(() => {
      this._saveCurrentSession();
    }, 2000);
  },

  /**
   * 检查是否需要提示总结
   */
  _checkSummarizeHint() {
    const totalChars = this._messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
    
    if (totalChars > this._summaryThreshold && Date.now() - this._lastSummaryTime > 300000) {
      // 显示总结提示
      this._showSummarizeHint();
    }
  },

  /**
   * 显示总结提示
   */
  _showSummarizeHint() {
    const container = $('#chat-messages');
    if (!container) return;
    
    // 检查是否已有提示
    if (container.querySelector('.summarize-hint')) return;
    
    const hint = document.createElement('div');
    hint.className = 'summarize-hint';
    hint.innerHTML = `
      <span>💡 对话内容较多，建议进行阶段性总结以优化上下文理解</span>
      <button id="do-summarize-btn">立即总结</button>
    `;
    
    container.insertBefore(hint, container.firstChild);
    
    // 绑定按钮事件
    $('#do-summarize-btn')?.addEventListener('click', () => {
      hint.remove();
      this._lastSummaryTime = Date.now();
      this._requestSummary();
    });
  },

  _renderMessages() {
    const container = $('#chat-messages');
    if (!container) return;
    
    // 如果没有消息，显示欢迎界面
    if (this._messages.length === 0) {
      container.innerHTML = `
        <div class="chat-welcome">
          <div class="chat-welcome-icon">🦞</div>
          <h3>欢迎使用 OpenClaw 智能对话</h3>
          <p>我可以帮你：</p>
          <ul>
            <li>📝 撰写文档、报告、邮件</li>
            <li>🔍 搜索和分析信息</li>
            <li>💻 编写和调试代码</li>
            <li>📊 处理 Excel 数据</li>
            <li>🌐 搜索网页获取最新信息</li>
            <li>📁 操作飞书文档和表格</li>
          </ul>
          <p class="chat-hint">输入你的问题或任务，我会尽力帮助你完成。</p>
        </div>
      `;
      return;
    }
    
    // 渲染消息列表
    let html = '';
    for (const msg of this._messages) {
      if (msg.role === 'user') {
        // IM 渠道消息：用特殊标签标识来源
        const imBadge = msg.isImMessage
          ? `<div style="font-size:11px;color:rgba(255,255,255,0.75);margin-bottom:4px;">${this._escapeHtml(msg.imSender || 'IM')}</div>`
          : '';
        // 附件标签展示
        const attachBadge = (msg.attachments && msg.attachments.length > 0)
          ? `<div class="chat-msg-attachments">${msg.attachments.map(a => {
              const sizeText = a.size < 1024 ? `${a.size}B` : `${Math.round(a.size / 1024)}KB`;
              return `<span class="chat-msg-attachment">📄 ${this._escapeHtml(a.name)} <span style="opacity:0.7">${sizeText}</span></span>`;
            }).join('')}</div>`
          : '';
        html += `
          <div class="chat-message user${msg.isImMessage ? ' im-message' : ''}">
            <div class="chat-avatar">${msg.isImMessage ? '💬' : '👤'}</div>
            <div class="chat-bubble">${imBadge}${this._escapeHtml(msg.content)}${attachBadge}</div>
          </div>
        `;
      } else {
        // 跳过 content/thinking 均为空的占位助手消息（等待阶段由 typing-message 展示）
        if (!msg.content && !msg.thinking) continue;
        const errorClass = msg.isError ? 'error' : '';
        const bubbleHtml = this._buildMessageHtml(msg);
        html += `
          <div class="chat-message assistant ${errorClass}">
            <div class="chat-avatar">🦞</div>
            <div class="chat-bubble">${bubbleHtml}</div>
          </div>
        `;
      }
    }
    
    container.innerHTML = html;
    
    // 为代码块添加复制按钮
    container.querySelectorAll('pre').forEach(pre => {
      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-btn';
      copyBtn.textContent = '复制';
      copyBtn.addEventListener('click', () => {
        const code = pre.querySelector('code')?.textContent || pre.textContent;
        navigator.clipboard.writeText(code).then(() => {
          copyBtn.textContent = '已复制';
          setTimeout(() => copyBtn.textContent = '复制', STYLES.copyButtonResetTime);
        });
      });
      pre.style.position = 'relative';
      pre.appendChild(copyBtn);
    });

    // 绑定思考卡片的展开/折叠
    container.querySelectorAll('.thinking-card').forEach(card => {
      const header = card.querySelector('.thinking-card-header');
      header?.addEventListener('click', () => {
        card.classList.toggle('expanded');
      });
    });

    // 添加滚动检测（检测是否滚动到顶部以加载更多消息）
    this._setupScrollDetection();

    // 更新加载更多指示器
    this._updateLoadMoreIndicator();

    // 滚动到底部（如果是初始加载）
    container.scrollTop = container.scrollHeight;
  },

  /**
   * 设置滚动检测
   */
  _setupScrollDetection() {
    const container = $('#chat-messages');
    if (!container) return;

    // 移除旧的监听器
    if (this._scrollHandler) {
      container.removeEventListener('scroll', this._scrollHandler);
    }

    // 创建新的滚动处理函数
    this._scrollHandler = () => {
      // 当滚动到顶部附近时自动加载更多
      if (container.scrollTop < 50 && !this._isLoadingMore && this._hasMoreMessages) {
        this._loadMoreMessages();
      }
    };

    container.addEventListener('scroll', this._scrollHandler);
  },

  _renderMarkdown(text) {
    if (!text) return '';
    
    // 简单的 Markdown 渲染
    let html = this._escapeHtml(text);
    
    // 代码块
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');
    
    // 行内代码
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // 标题
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    
    // 粗体和斜体
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    
    // 链接
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    
    // 列表
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    
    // 有序列表
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    
    // 段落
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';
    
    // 清理空段落
    html = html.replace(/<p>\s*<\/p>/g, '');
    
    return html;
  },

  _escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  // ===== 右键菜单 =====

  /**
   * 显示右键菜单
   */
  _showContextMenu(e) {
    e.preventDefault();

    // 销毁旧菜单
    this._hideContextMenu();

    // 判断是否在消息气泡上
    const bubble = e.target.closest('.chat-bubble');
    const msgEl = e.target.closest('.chat-message');
    if (!bubble && !msgEl) return;

    // 获取选中文本
    const selectedText = window.getSelection()?.toString() || '';

    // 获取当前消息纯文本
    let messageText = '';
    if (bubble) {
      messageText = bubble.innerText || bubble.textContent || '';
    }

    // 判断是否是用户消息
    const isUserMsg = msgEl?.classList.contains('user');

    // 构建菜单
    const menu = document.createElement('div');
    menu.className = 'chat-context-menu';
    menu.id = 'chat-context-menu';

    const items = [];

    // 复制选中文本（有选中时才激活）
    if (selectedText) {
      items.push({
        icon: '📋',
        label: '复制选中文字',
        action: () => {
          navigator.clipboard.writeText(selectedText).catch(() => {
            document.execCommand('copy');
          });
        }
      });
    }

    // 复制全部内容
    items.push({
      icon: '📄',
      label: '复制全部内容',
      disabled: !messageText,
      action: () => {
        if (messageText) {
          navigator.clipboard.writeText(messageText).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = messageText;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
          });
        }
      }
    });

    // 分隔线
    if (!isUserMsg) {
      items.push({ divider: true });

      // 全选文本
      items.push({
        icon: '🔤',
        label: '全选文字',
        action: () => {
          if (bubble) {
            const range = document.createRange();
            range.selectNodeContents(bubble);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
      });
    }

    // 渲染菜单项
    for (const item of items) {
      if (item.divider) {
        const divider = document.createElement('div');
        divider.className = 'context-menu-divider';
        menu.appendChild(divider);
      } else {
        const el = document.createElement('div');
        el.className = 'context-menu-item' + (item.disabled ? ' disabled' : '') + (item.danger ? ' danger' : '');
        el.innerHTML = `<span class="context-menu-icon">${item.icon}</span><span>${item.label}</span>`;
        if (!item.disabled) {
          el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            item.action();
            this._hideContextMenu();
            // 复制成功轻提示
            this._showCopyToast();
          });
        }
        menu.appendChild(el);
      }
    }

    // 定位菜单（防止超出视口）
    document.body.appendChild(menu);
    this._contextMenu = menu;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const mw = menu.offsetWidth || 180;
    const mh = menu.offsetHeight || 120;

    let x = e.clientX;
    let y = e.clientY;
    if (x + mw > vw - 8) x = vw - mw - 8;
    if (y + mh > vh - 8) y = vh - mh - 8;
    if (x < 4) x = 4;
    if (y < 4) y = 4;

    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
  },

  /**
   * 隐藏右键菜单
   */
  _hideContextMenu() {
    if (this._contextMenu) {
      this._contextMenu.remove();
      this._contextMenu = null;
    }
    // 兼容：用 id 也删一次
    const old = document.getElementById('chat-context-menu');
    if (old) old.remove();
  },

  /**
   * 显示复制成功轻提示
   */
  _showCopyToast() {
    // 如果已有 toast，跳过
    if (document.getElementById('copy-toast')) return;
    const toast = document.createElement('div');
    toast.id = 'copy-toast';
    toast.textContent = '✅ 已复制';
    toast.style.cssText = `
      position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
      background: rgba(0,0,0,0.72); color: #fff; padding: 7px 20px;
      border-radius: 20px; font-size: 13px; z-index: 99999;
      pointer-events: none; animation: toastFade 1.8s ease forwards;
    `;
    // 动画样式
    const style = document.createElement('style');
    style.textContent = `@keyframes toastFade { 0%{opacity:0;transform:translateX(-50%) translateY(8px)} 15%{opacity:1;transform:translateX(-50%) translateY(0)} 75%{opacity:1} 100%{opacity:0;transform:translateX(-50%) translateY(-4px)} }`;
    document.head.appendChild(style);
    document.body.appendChild(toast);
    setTimeout(() => { toast.remove(); style.remove(); }, 1900);
  },

  /**
   * 从 stdout 中提取内容（作为后备方案）
   */
  _extractContentFromStdout(stdout) {
    if (!stdout) return null;
    
    // ★ 诊断日志
    console.log('[ChatTab] _extractContentFromStdout: input length=', stdout?.length, 'first 200 chars:', stdout?.slice(0, 200));
    
    try {
      // 方法1：尝试直接解析整个 stdout
      const trimmed = stdout.trim();
      if (trimmed.startsWith('{')) {
        try {
          const obj = JSON.parse(trimmed);
          if (obj.result?.payloads && Array.isArray(obj.result.payloads)) {
            const texts = obj.result.payloads
              .filter(p => p.text && p.text !== 'Unknown error')
              .map(p => p.text);
            if (texts.length > 0) {
              console.log('[ChatTab] _extractContentFromStdout: layer1-full success, got', texts.join('').length, 'chars');
              return texts.join('');
            }
          }
          // ★ 也尝试顶层 payloads 格式
          if (obj.payloads && Array.isArray(obj.payloads)) {
            const texts = obj.payloads
              .filter(p => p.text && p.text !== 'Unknown error' && (p.type === undefined || p.type === 'text'))
              .map(p => p.text);
            if (texts.length > 0) {
              console.log('[ChatTab] _extractContentFromStdout: layer1-full payloads success, got', texts.join('').length, 'chars');
              return texts.join('');
            }
          }
        } catch (e) {
          // 不是单个 JSON，继续下一步
        }
      }
      
      // 方法2：从 stdout 中提取 JSON 部分（找到第一个 { 和最后一个 }）
      const firstBrace = stdout.indexOf('{');
      const lastBrace = stdout.lastIndexOf('}');
      
      if (firstBrace !== -1 && lastBrace !== -1 && firstBrace < lastBrace) {
        const jsonStr = stdout.substring(firstBrace, lastBrace + 1);
        try {
          const obj = JSON.parse(jsonStr);
          if (obj.result?.payloads && Array.isArray(obj.result.payloads)) {
            const texts = obj.result.payloads
              .filter(p => p.text && p.text !== 'Unknown error')
              .map(p => p.text);
            if (texts.length > 0) {
              console.log('[ChatTab] _extractContentFromStdout: layer2-extract success, got', texts.join('').length, 'chars');
              return texts.join('');
            }
          }
          // ★ 也尝试顶层 payloads 格式
          if (obj.payloads && Array.isArray(obj.payloads)) {
            const texts = obj.payloads
              .filter(p => p.text && p.text !== 'Unknown error' && (p.type === undefined || p.type === 'text'))
              .map(p => p.text);
            if (texts.length > 0) {
              console.log('[ChatTab] _extractContentFromStdout: layer2-extract payloads success, got', texts.join('').length, 'chars');
              return texts.join('');
            }
          }
        } catch (e) {
          // 解析失败，继续下一步
        }
      }
      
      // 方法3：按行解析（兼容旧逻辑）
      const lines = stdout.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        const trimmed = line.trim();
        // ★ 跳过 [plugins] 等日志行
        if (trimmed.startsWith('[') && !trimmed.startsWith('[{')) continue;
        if (!trimmed.startsWith('{')) continue;
        try {
          const obj = JSON.parse(trimmed);
          // 尝试提取 OpenClaw 格式的内容
          if (obj.result?.payloads && Array.isArray(obj.result.payloads)) {
            const texts = obj.result.payloads
              .filter(p => p.text && p.text !== 'Unknown error')
              .map(p => p.text);
            if (texts.length > 0) {
              console.log('[ChatTab] _extractContentFromStdout: layer3-line success, got', texts.join('').length, 'chars');
              return texts.join('');
            }
          }
          // 兼容旧格式（本地模式：只有 text 无 type；旧格式：type='text'）
          if (obj.payloads && Array.isArray(obj.payloads)) {
            const texts = obj.payloads
              .filter(p => p.text && p.text !== 'Unknown error' && (p.type === undefined || p.type === 'text'))
              .map(p => p.text);
            if (texts.length > 0) {
              console.log('[ChatTab] _extractContentFromStdout: layer3-line payloads success, got', texts.join('').length, 'chars');
              return texts.join('');
            }
          }
        } catch (e) {
          // 忽略解析错误，继续下一行
        }
      }
      
      // ★ 方法4：反向遍历，找最后一个有效的 JSON 对象
      for (let i = lines.length - 1; i >= 0; i--) {
        const trimmed = lines[i].trim();
        if (!trimmed.startsWith('{')) continue;
        try {
          const obj = JSON.parse(trimmed);
          // 尝试从任何包含 text 字段的对象中提取
          if (obj.text && typeof obj.text === 'string' && obj.text !== 'Unknown error') {
            console.log('[ChatTab] _extractContentFromStdout: layer4-reverse text success, got', obj.text.length, 'chars');
            return obj.text;
          }
          // 递归检查嵌套结构
          const nested = this._findTextInObject(obj);
          if (nested) {
            console.log('[ChatTab] _extractContentFromStdout: layer4-nested success, got', nested.length, 'chars');
            return nested;
          }
        } catch (e) {
          // 忽略
        }
      }
      
      console.log('[ChatTab] _extractContentFromStdout: all layers failed');
    } catch (e) {
      console.error('Failed to extract content from stdout:', e);
    }
    
    return null;
  },

  /**
   * 从对象中递归查找 text 字段
   */
  _findTextInObject(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 5) return null;
    
    // 检查 payloads
    const payloads = obj.result?.payloads || obj.payloads;
    if (Array.isArray(payloads)) {
      const texts = payloads
        .filter(p => p.text && p.text !== 'Unknown error' && (p.type === undefined || p.type === 'text'))
        .map(p => p.text);
      if (texts.length > 0) return texts.join('');
    }
    
    // 检查直接的 text 字段
    if (obj.text && typeof obj.text === 'string' && obj.text !== 'Unknown error') {
      return obj.text;
    }
    
    // 递归检查子对象
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object') {
        const found = this._findTextInObject(obj[key], depth + 1);
        if (found) return found;
      }
    }
    
    return null;
  },

  /**
   * 从 stdout 中提取纯文本（去除 JSON 和日志）
   * 作为最终兜底：当 JSON 解析全部失败时，尝试提取有意义的文本
   */
  _extractPlainTextFromStdout(stdout) {
    if (!stdout) return null;
    
    const lines = stdout.split('\n');
    const textLines = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      // 跳过空行
      if (!trimmed) continue;
      // 跳过 JSON 行
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) continue;
      // 跳过日志行
      if (trimmed.startsWith('[plugins]') || trimmed.startsWith('[debug]') || trimmed.startsWith('[info]')) continue;
      // 跳过错误堆栈
      if (trimmed.startsWith('at ') || trimmed.includes('Error:')) continue;
      // 收集有意义的文本行
      textLines.push(trimmed);
    }
    
    const result = textLines.join('\n').trim();
    if (result.length > 20) {
      console.log('[ChatTab] _extractPlainTextFromStdout: found', result.length, 'chars of plain text');
      return result;
    }
    
    return null;
  },

  _showTypingIndicator() {
    const container = $('#chat-messages');
    if (!container) return;

    // 检查是否已存在
    if (container.querySelector('.typing-message')) return;

    this._waitingPhase = 'connecting';
    this._waitingStartTime = Date.now();

    const indicator = document.createElement('div');
    indicator.className = 'chat-message assistant typing-message';
    indicator.innerHTML = `
      <div class="chat-avatar">🦞</div>
      <div class="chat-bubble" style="padding: 0; background: transparent;">
        ${this._buildWaitingCardHtml()}
      </div>
    `;
    container.appendChild(indicator);
    container.scrollTop = container.scrollHeight;

    // 每秒刷新计时
    this._waitingTimer = setInterval(() => {
      this._updateWaitingCard();
    }, 1000);

    // 30s 连接超时预警：如果仍在 connecting 阶段，显示警告提示
    if (this._connectingWarnTimer) clearTimeout(this._connectingWarnTimer);
    this._connectingWarnTimer = setTimeout(() => {
      if (this._waitingPhase === 'connecting' && this._isStreaming) {
        this._setStatus('⚠️ 连接时间较长，请检查 Gateway 服务是否正常运行', 'error');
      }
    }, TIMEOUTS.statusPollInterval);
  },

  /** 构建等待进度卡片 HTML */
  _buildWaitingCardHtml() {
    const elapsed = Math.floor((Date.now() - this._waitingStartTime) / 1000);
    const phase = this._waitingPhase;

    const steps = [
      { id: 'connecting', label: '连接服务' },
      { id: 'thinking',   label: '深度思考' },
      { id: 'generating', label: '生成回答' }
    ];
    const phaseOrder = { connecting: 0, thinking: 1, generating: 2 };
    const curIdx = phaseOrder[phase] ?? 0;

    const phaseLabels = {
      connecting: '正在连接...',
      thinking:   '深度思考中...',
      generating: '生成回答中...'
    };
    const phaseIcons = {
      connecting: '🔗',
      thinking:   '🧠',
      generating: '✍️'
    };

    const stepsHtml = steps.map((s, i) => {
      let cls = '';
      if (i < curIdx) cls = 'done';
      else if (i === curIdx) cls = 'active';
      const icon = i < curIdx ? '✓' : (i === curIdx ? '' : '');
      return `
        <div class="waiting-step ${cls}">
          <span class="waiting-step-dot"></span>
          <span>${s.label}</span>
          ${i < curIdx ? '<span style="margin-left:auto;font-size:11px;">✓</span>' : ''}
          ${i === curIdx ? '<span style="margin-left:auto;font-size:11px;color:#667eea;">进行中</span>' : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="waiting-card">
        <div class="waiting-card-row">
          <div class="waiting-spinner-row">
            <div class="waiting-spinner"></div>
            <span class="waiting-phase-label">${phaseLabels[phase]}</span>
          </div>
          <span class="waiting-timer">${elapsed}s</span>
        </div>
        <div class="waiting-steps">${stepsHtml}</div>
        <div style="text-align:right;margin-top:6px;">
          <button id="waiting-cancel-btn" style="font-size:11px;padding:3px 10px;border:1px solid var(--border,#555);border-radius:4px;background:transparent;color:var(--text-muted,#999);cursor:pointer;" onclick="TabChat._cancelStreaming()">取消</button>
        </div>
      </div>
    `;
  },

  /** 刷新等待卡片内容（每秒调用） */
  _updateWaitingCard() {
    const indicator = document.querySelector('.typing-message');
    if (!indicator) return;
    const bubble = indicator.querySelector('.chat-bubble');
    if (bubble) bubble.innerHTML = this._buildWaitingCardHtml();
  },

  /** 切换等待阶段 */
  _setWaitingPhase(phase) {
    this._waitingPhase = phase;
    this._updateWaitingCard();
    // 同步状态栏
    const labels = { connecting: '正在连接服务...', thinking: '深度思考中...', generating: '生成回答中...' };
    this._setStatus(labels[phase] || '处理中...', 'streaming');
  },

  /** 用户主动取消正在进行中的请求 */
  _cancelStreaming() {
    if (!this._isStreaming) return;
    this._isStreaming = false;
    this._hideTypingIndicator();

    // 移除空的占位助手消息
    const lastMessage = this._messages[this._messages.length - 1];
    if (lastMessage && lastMessage.role === 'assistant' && !lastMessage.content && !lastMessage.thinking) {
      this._messages.pop();
    }

    this._renderMessages();
    this._setStatus('已取消', 'error');
    this._updateSendButton();

    // 2s 后清除状态栏提示
    setTimeout(() => {
      if (!this._isStreaming) this._setStatus('');
    }, 2000);
  },

  _hideTypingIndicator() {
    if (this._waitingTimer) {
      clearInterval(this._waitingTimer);
      this._waitingTimer = null;
    }
    if (this._connectingWarnTimer) {
      clearTimeout(this._connectingWarnTimer);
      this._connectingWarnTimer = null;
    }
    const indicator = document.querySelector('.typing-message');
    if (indicator) {
      indicator.remove();
    }
  },

  _setStatus(text, type = '') {
    const status = $('#chat-status');
    if (!status) return;
    
    status.textContent = text;
    status.className = 'chat-status' + (type ? ' ' + type : '');
  },

  async _clearChat() {
    // 先保存当前会话
    await this._saveCurrentSession();
    
    this._messages = [];
    this._currentSessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    this._renderMessages();
    this._setStatus('');
    
    // 通知后端清理会话
    window.openclawAPI.chat.clearSession(this._currentSessionId);
  },

  activate() {
    // 重新订阅流式响应
    this._subscribeStream();
    this._updateSendButton();
  },

  async cleanup() {
    // 保存当前会话
    await this._saveCurrentSession();
    
    if (this._streamUnsubscribe) {
      this._streamUnsubscribe();
      this._streamUnsubscribe = null;
    }

    if (this._imUnsubscribe) {
      this._imUnsubscribe();
      this._imUnsubscribe = null;
      window.openclawAPI.chat.stopImWatch();
    }
    
    if (this._autoSaveTimer) {
      clearTimeout(this._autoSaveTimer);
      this._autoSaveTimer = null;
    }

    if (this._waitingTimer) {
      clearInterval(this._waitingTimer);
      this._waitingTimer = null;
    }

    if (this._connectingWarnTimer) {
      clearTimeout(this._connectingWarnTimer);
      this._connectingWarnTimer = null;
    }
  }
};
