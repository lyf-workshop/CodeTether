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

open class MainActivity : ComponentActivity() {
    private lateinit var controller: TabletController

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        controller = ViewModelProvider(this, controllerFactory())[TabletController::class.java]
        setContent {
            val state by controller.state.collectAsStateWithLifecycle()
            TabletApp(state, controller)
        }
    }

    protected open fun controllerFactory(): ViewModelProvider.Factory = defaultViewModelProviderFactory

    override fun onStart() {
        super.onStart()
        controller.foreground(true)
    }

    override fun onStop() {
        if (!isChangingConfigurations) controller.foreground(false)
        super.onStop()
    }
}
