fn main() {
    // Bake SERVER_URL and AUTH_TOKEN into the binary at compile time
    let server_url = std::env::var("SERVER_URL")
        .unwrap_or_else(|_| "https://hots-overlay.azurewebsites.net".to_string());
    let auth_token = std::env::var("AUTH_TOKEN")
        .unwrap_or_else(|_| "your-secret-token".to_string());

    println!("cargo:rustc-env=DEFAULT_SERVER_URL={server_url}");
    println!("cargo:rustc-env=DEFAULT_AUTH_TOKEN={auth_token}");

    // Re-run if env vars change
    println!("cargo:rerun-if-env-changed=SERVER_URL");
    println!("cargo:rerun-if-env-changed=AUTH_TOKEN");

    // Windows: embed icon in exe
    #[cfg(windows)]
    {
        let mut res = winres::WindowsResource::new();
        res.set_icon("assets/icon.ico");
        res.compile().expect("Failed to compile Windows resources");
    }
}
