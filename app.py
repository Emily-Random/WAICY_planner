#!/usr/bin/env python3
"""
Axis Application Launcher
Starts the Node.js server and opens the application in the default browser.
"""

import subprocess
import webbrowser
import time
import sys
import os
import signal

# Configuration
PORT = 3000
SERVER_URL = f"http://localhost:{PORT}"

def check_node_installed():
    """Check if Node.js is installed."""
    try:
        result = subprocess.run(
            ["node", "--version"],
            capture_output=True,
            text=True
        )
        return result.returncode == 0
    except FileNotFoundError:
        return False

def check_dependencies_installed():
    """Check if all required node_modules are properly installed."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    node_modules = os.path.join(script_dir, "node_modules")
    
    if not os.path.exists(node_modules):
        return False
    
    # Check for key packages that must be present
    required_packages = ["express", "helmet", "cors", "bcryptjs", "jsonwebtoken", "dotenv"]
    for pkg in required_packages:
        pkg_path = os.path.join(node_modules, pkg)
        if not os.path.exists(pkg_path):
            return False
    
    return True

def get_script_dir():
    """Get the directory containing this script."""
    return os.path.dirname(os.path.abspath(__file__))

def install_dependencies():
    """Install npm dependencies."""
    print("Installing dependencies...")
    try:
        subprocess.run(
            ["npm", "install"],
            cwd=get_script_dir(),
            check=True
        )
        print("✓ Dependencies installed successfully")
        return True
    except subprocess.CalledProcessError as e:
        print(f"✗ Failed to install dependencies: {e}")
        return False

def start_server():
    """Start the Node.js server."""
    print(f"Starting Axis server on {SERVER_URL}...")
    
    script_dir = get_script_dir()
    
    # Start the server as a subprocess
    server_process = subprocess.Popen(
        ["node", "server.js"],
        cwd=script_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True
    )
    
    return server_process

def wait_for_server(timeout=30):
    """Wait for the server to be ready by checking if port is open."""
    import socket
    
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(1)
            result = sock.connect_ex(('127.0.0.1', PORT))
            sock.close()
            if result == 0:
                # Port is open, give the server a moment to fully initialize
                time.sleep(0.5)
                return True
        except Exception:
            pass
        time.sleep(0.3)
    return False

def open_browser():
    """Open the application in the default browser."""
    print(f"Opening browser at {SERVER_URL}...")
    webbrowser.open(SERVER_URL)

def main():
    """Main entry point."""
    print("=" * 50)
    print("  Axis - AI Study Planner")
    print("=" * 50)
    print()
    
    # Check Node.js installation
    if not check_node_installed():
        print("✗ Error: Node.js is not installed.")
        print("  Please install Node.js from https://nodejs.org/")
        sys.exit(1)
    print("✓ Node.js is installed")
    
    # Check and install dependencies if needed
    if not check_dependencies_installed():
        print("Node modules not found.")
        if not install_dependencies():
            sys.exit(1)
    else:
        print("✓ Dependencies are installed")
    
    # Start the server
    server_process = start_server()
    
    # Handle graceful shutdown
    def signal_handler(signum, frame):
        print("\n\nShutting down Axis server...")
        server_process.terminate()
        try:
            server_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server_process.kill()
        print("Server stopped.")
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # Wait for server to be ready
    print("Waiting for server to start...")
    if wait_for_server(timeout=30):
        print(f"✓ Server is running at {SERVER_URL}")
        open_browser()
    else:
        print("✗ Server failed to start within timeout")
        server_process.terminate()
        sys.exit(1)
    
    print()
    print("Press Ctrl+C to stop the server")
    print("-" * 50)
    print()
    
    # Stream server output
    try:
        while True:
            output = server_process.stdout.readline()
            if output:
                print(output, end="")
            elif server_process.poll() is not None:
                # Server process has ended
                print("\nServer process ended unexpectedly.")
                break
    except KeyboardInterrupt:
        signal_handler(None, None)

if __name__ == "__main__":
    main()
