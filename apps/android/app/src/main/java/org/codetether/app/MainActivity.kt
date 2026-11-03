package org.codetether.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.codetether.app.ui.TabletApp
import org.codetether.app.ui.TabletController

class MainActivity : ComponentActivity() {
    private lateinit var controller: TabletController

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        controller = ViewModelProvider(this)[TabletController::class.java]
        setContent {
            val state by controller.state.collectAsStateWithLifecycle()
            TabletApp(state, controller)
        }
    }

    override fun onStart() {
        super.onStart()
        controller.foreground(true)
    }

    override fun onStop() {
        controller.foreground(false)
        super.onStop()
    }
}
