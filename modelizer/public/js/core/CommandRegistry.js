/** Named commands shared by buttons ([data-command]), menus and keyboard shortcuts. */
export class CommandRegistry {
  constructor() {
    this.commands = new Map();
  }

  register(id, run, { enabled = () => true } = {}) {
    this.commands.set(id, { run, enabled });
    return this;
  }

  has(id) { return this.commands.has(id); }

  isEnabled(id) {
    const command = this.commands.get(id);
    return !!command && command.enabled();
  }

  run(id, context = {}) {
    const command = this.commands.get(id);
    if (!command || !command.enabled()) return undefined;
    return command.run(context);
  }
}
